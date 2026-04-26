import { useEffect, useRef, useState } from "preact/hooks";
import { AutotuneGraph } from "./graphs";
import { getAdminSecret } from "./auth";
import { sendWsCommand, useSocketState } from "./websocket";

type PidTarget = "BT" | "ET" | "simBT";
type PidMethod = "ziegler-nichols" | "tyreus-luyben" | "pessen-integral" | "no-overshoot";
type ControlMode = "pid" | "adrc" | "fuzzy" | "mpc";
type LegacyTuneMode = "pid" | "adrc";

export function AutotuneApp() {
  const { lastMessage } = useSocketState();
  const [target, setTarget] = useState<PidTarget>("BT");
  const [method, setMethod] = useState<PidMethod>("ziegler-nichols");
  const [controlMode, setControlMode] = useState<ControlMode>("pid");
  const [legacyTuneMode, setLegacyTuneMode] = useState<LegacyTuneMode>("pid");
  const [useBeanLoadedTune, setUseBeanLoadedTune] = useState(false);
  const [setpoint, setSetpoint] = useState(20);
  const [fanSpeed, setFanSpeed] = useState(50);
  const [minHeaterPwm, setMinHeaterPwm] = useState(0);
  const [maxHeaterPwm, setMaxHeaterPwm] = useState(60);
  const [controlFanMin, setControlFanMin] = useState(30);
  const [controlFanMax, setControlFanMax] = useState(80);
  const [adrcFanControlEnabled, setAdrcFanControlEnabled] = useState(true);
  const [delayFan, setDelayFan] = useState(50);
  const [delayHeater, setDelayHeater] = useState(60);
  const [processDelaySec, setProcessDelaySec] = useState(0);
  const [kp, setKp] = useState(1.0);
  const [ki, setKi] = useState(0.1);
  const [kd, setKd] = useState(0.01);
  const [adrcB0, setAdrcB0] = useState(0.02);
  const [adrcW0, setAdrcW0] = useState(1.0);
  const [adrcWc, setAdrcWc] = useState(0.25);
  const [adrcScheduleEnabled, setAdrcScheduleEnabled] = useState(true);
  const [heaterSlew, setHeaterSlew] = useState(25);
  const [fanSlew, setFanSlew] = useState(12);
  const [tbFilterAlpha, setTbFilterAlpha] = useState(0.25);
  const [teFilterAlpha, setTeFilterAlpha] = useState(0.25);
  const [dtFilterAlpha, setDTFilterAlpha] = useState(0.25);
  const [rorFilterAlpha, setRorFilterAlpha] = useState(0.2);
  const [pidDerivativeAlpha, setPidDerivativeAlpha] = useState(0.3);
  const [pidSmithGain, setPidSmithGain] = useState(0.02);
  const [pidSmithTau, setPidSmithTau] = useState(20);
  const [fuzzyETScale, setFuzzyETScale] = useState(20);
  const [fuzzyERorScale, setFuzzyERorScale] = useState(20);
  const [fuzzyDTLow, setFuzzyDTLow] = useState(10);
  const [fuzzyDTHigh, setFuzzyDTHigh] = useState(70);
  const [fuzzyHeaterStepScale, setFuzzyHeaterStepScale] = useState(8);
  const [fuzzyFanStepScale, setFuzzyFanStepScale] = useState(5);
  const [mpcTbWeight, setMpcTbWeight] = useState(1);
  const [mpcTeWeight, setMpcTeWeight] = useState(0.1);
  const [mpcMoveHeaterWeight, setMpcMoveHeaterWeight] = useState(0.35);
  const [mpcMoveFanWeight, setMpcMoveFanWeight] = useState(1.2);
  const [mpcRorWeight, setMpcRorWeight] = useState(0.1);
  const [mpcHorizon, setMpcHorizon] = useState(8);
  const [noBeanFan, setNoBeanFan] = useState(50);
  const [noBeanHeaterLow, setNoBeanHeaterLow] = useState(0);
  const [noBeanHeaterHigh, setNoBeanHeaterHigh] = useState(60);
  const [noBeanFanHigh, setNoBeanFanHigh] = useState(70);
  const [noBeanBaselineSec, setNoBeanBaselineSec] = useState(15);
  const [noBeanStepSec, setNoBeanStepSec] = useState(35);
  const [history, setHistory] = useState<Array<{ ET: number; BT: number; simBT: number }>>([]);
  const [autotuneLog, setAutotuneLog] = useState<string[]>([]);
  const lastCrossing = useRef(-1);
  const lastAdrcPhase = useRef("");
  const wasPidAutotuneRunning = useRef(false);
  const wasAdrcAutotuneRunning = useRef(false);
  const autotuneStopRequested = useRef(false);
  const autotuneBoundsDirty = useRef(false);
  const controlFanBoundsDirty = useRef(false);
  const adrcFanControlDirty = useRef(false);
  const adrcScheduleDirty = useRef(false);
  const delayInputsDirty = useRef(false);
  const adrcValuesDirty = useRef(false);
  const frameworkValuesDirty = useRef(false);
  const pidSmithValuesDirty = useRef(false);
  const fuzzyValuesDirty = useRef(false);
  const mpcValuesDirty = useRef(false);
  const controlModeDirty = useRef(false);
  const legacyTuneModeDirty = useRef(false);

  const sendCommand = (data: Record<string, unknown>) => {
    const authToken = getAdminSecret();
    sendWsCommand({ ...data, authToken });
  };

  useEffect(() => {
    if (!lastMessage) return;
    const pidAutotuneRunning = Boolean(lastMessage.pidAutotune);
    const adrcAutotuneRunning = Boolean(lastMessage.adrcAutotune);
    const pidAutotuneJustCompleted = wasPidAutotuneRunning.current && !pidAutotuneRunning;
    const adrcAutotuneJustCompleted = wasAdrcAutotuneRunning.current && !adrcAutotuneRunning;

    if (
      lastMessage.controlMode === "pid" ||
      lastMessage.controlMode === "adrc" ||
      lastMessage.controlMode === "fuzzy" ||
      lastMessage.controlMode === "mpc"
    ) {
      if (!controlModeDirty.current) {
        setControlMode(lastMessage.controlMode);
      } else if (lastMessage.controlMode === controlMode) {
        controlModeDirty.current = false;
      }
    }
    if (lastMessage.autotuneMode === "pid" || lastMessage.autotuneMode === "adrc") {
      if (!legacyTuneModeDirty.current) {
        setLegacyTuneMode(lastMessage.autotuneMode);
      } else if (lastMessage.autotuneMode === legacyTuneMode) {
        legacyTuneModeDirty.current = false;
      }
    }

    if (
      lastMessage.pidAutotune &&
      typeof lastMessage.pidAutotuneCrossings === "number" &&
      lastMessage.pidAutotuneCrossings > 0 &&
      lastMessage.pidAutotuneCrossings !== lastCrossing.current
    ) {
      lastCrossing.current = lastMessage.pidAutotuneCrossings;
      setAutotuneLog((prev) => [
        ...prev.slice(-24),
        `Crossing ${lastMessage.pidAutotuneCrossings}/${lastMessage.pidAutotuneTargetCrossings ?? "?"} • Heater ${lastMessage.pidAutotuneHeaterCommand ?? "?"}%`,
      ]);
    }

    if (lastMessage.adrcAutotune && lastMessage.adrcAutotunePhase && lastMessage.adrcAutotunePhase !== lastAdrcPhase.current) {
      lastAdrcPhase.current = lastMessage.adrcAutotunePhase;
      setAutotuneLog((prev) => [
        ...prev.slice(-24),
        `ADRC ${lastMessage.adrcAutotunePhase} • slope ${formatValue(lastMessage.adrcAutotunePeakSlope, 4)} °C/s`,
      ]);
    } else if (!lastMessage.adrcAutotune && lastAdrcPhase.current) {
      lastAdrcPhase.current = "";
    }

    if (!lastMessage.pidAutotune && typeof lastMessage.pidKpActive === "number") {
      const nextKp = lastMessage.pidKpActive;
      const nextKi = lastMessage.pidKiActive ?? ki;
      const nextKd = lastMessage.pidKdActive ?? kd;
      setKp(nextKp);
      setKi(nextKi);
      setKd(nextKd);
      if (pidAutotuneJustCompleted) {
        const message = autotuneStopRequested.current
          ? "PID autotune stopped."
          : `PID tuning finished: Kp ${nextKp.toFixed(4)}, Ki ${nextKi.toFixed(4)}, Kd ${nextKd.toFixed(4)}`;
        setAutotuneLog((prev) => [...prev.slice(-24), message]);
        autotuneStopRequested.current = false;
      }
    }

    const nextAdrcB0 = lastMessage.adrcB0;
    const nextAdrcW0 = lastMessage.adrcW0;
    const nextAdrcWc = lastMessage.adrcWc;
    if (typeof nextAdrcB0 === "number" && typeof nextAdrcW0 === "number" && typeof nextAdrcWc === "number") {
      if (!adrcValuesDirty.current || adrcAutotuneJustCompleted) {
        setAdrcB0(nextAdrcB0);
        setAdrcW0(nextAdrcW0);
        setAdrcWc(nextAdrcWc);
        adrcValuesDirty.current = false;
        if (adrcAutotuneJustCompleted) {
          const message = autotuneStopRequested.current
            ? "ADRC autotune stopped."
            : `ADRC tuning finished: b0 ${nextAdrcB0.toFixed(4)}, w0 ${nextAdrcW0.toFixed(4)}, wc ${nextAdrcWc.toFixed(4)}`;
          setAutotuneLog((prev) => [
            ...prev.slice(-24),
            message,
          ]);
          autotuneStopRequested.current = false;
        }
      } else {
        const b0Matches = Math.abs(nextAdrcB0 - adrcB0) < 0.0001;
        const w0Matches = Math.abs(nextAdrcW0 - adrcW0) < 0.0001;
        const wcMatches = Math.abs(nextAdrcWc - adrcWc) < 0.0001;
        if (b0Matches && w0Matches && wcMatches) {
          adrcValuesDirty.current = false;
        }
      }
    }

    if (typeof lastMessage.pidAutotuneMin === "number" && typeof lastMessage.pidAutotuneMax === "number") {
      if (!autotuneBoundsDirty.current) {
        setMinHeaterPwm(lastMessage.pidAutotuneMin);
        setMaxHeaterPwm(lastMessage.pidAutotuneMax);
      } else {
        const minMatches = Math.abs(lastMessage.pidAutotuneMin - minHeaterPwm) < 0.01;
        const maxMatches = Math.abs(lastMessage.pidAutotuneMax - maxHeaterPwm) < 0.01;
        if (minMatches && maxMatches) {
          autotuneBoundsDirty.current = false;
        }
      }
    }
    if (typeof lastMessage.controlFanMin === "number" && typeof lastMessage.controlFanMax === "number") {
      if (!controlFanBoundsDirty.current) {
        setControlFanMin(lastMessage.controlFanMin);
        setControlFanMax(lastMessage.controlFanMax);
      } else {
        const minMatches = Math.abs(lastMessage.controlFanMin - controlFanMin) < 0.01;
        const maxMatches = Math.abs(lastMessage.controlFanMax - controlFanMax) < 0.01;
        if (minMatches && maxMatches) {
          controlFanBoundsDirty.current = false;
        }
      }
    }
    if (typeof lastMessage.adrcFanControlEnabled === "boolean") {
      if (!adrcFanControlDirty.current) {
        setAdrcFanControlEnabled(lastMessage.adrcFanControlEnabled);
      } else if (lastMessage.adrcFanControlEnabled === adrcFanControlEnabled) {
        adrcFanControlDirty.current = false;
      }
    }
    if (typeof lastMessage.adrcScheduleEnabled === "boolean") {
      if (!adrcScheduleDirty.current) {
        setAdrcScheduleEnabled(lastMessage.adrcScheduleEnabled);
      } else if (lastMessage.adrcScheduleEnabled === adrcScheduleEnabled) {
        adrcScheduleDirty.current = false;
      }
    }
    if (!frameworkValuesDirty.current) {
      if (typeof lastMessage.controlHeaterSlewPerSec === "number") setHeaterSlew(lastMessage.controlHeaterSlewPerSec);
      if (typeof lastMessage.controlFanSlewPerSec === "number") setFanSlew(lastMessage.controlFanSlewPerSec);
      if (typeof lastMessage.filterTbAlpha === "number") setTbFilterAlpha(lastMessage.filterTbAlpha);
      if (typeof lastMessage.filterTeAlpha === "number") setTeFilterAlpha(lastMessage.filterTeAlpha);
      if (typeof lastMessage.filterDTAlpha === "number") setDTFilterAlpha(lastMessage.filterDTAlpha);
      if (typeof lastMessage.filterRorAlpha === "number") setRorFilterAlpha(lastMessage.filterRorAlpha);
    }
    if (!pidSmithValuesDirty.current) {
      if (typeof lastMessage.pidDerivativeFilterAlpha === "number") setPidDerivativeAlpha(lastMessage.pidDerivativeFilterAlpha);
      if (typeof lastMessage.pidSmithModelGain === "number") setPidSmithGain(lastMessage.pidSmithModelGain);
      if (typeof lastMessage.pidSmithModelTauSec === "number") setPidSmithTau(lastMessage.pidSmithModelTauSec);
    }
    if (!fuzzyValuesDirty.current) {
      if (typeof lastMessage.fuzzyETScale === "number") setFuzzyETScale(lastMessage.fuzzyETScale);
      if (typeof lastMessage.fuzzyERorScale === "number") setFuzzyERorScale(lastMessage.fuzzyERorScale);
      if (typeof lastMessage.fuzzyDTLow === "number") setFuzzyDTLow(lastMessage.fuzzyDTLow);
      if (typeof lastMessage.fuzzyDTHigh === "number") setFuzzyDTHigh(lastMessage.fuzzyDTHigh);
      if (typeof lastMessage.fuzzyHeaterStepScale === "number") setFuzzyHeaterStepScale(lastMessage.fuzzyHeaterStepScale);
      if (typeof lastMessage.fuzzyFanStepScale === "number") setFuzzyFanStepScale(lastMessage.fuzzyFanStepScale);
    }
    if (!mpcValuesDirty.current) {
      if (typeof lastMessage.mpcTbWeight === "number") setMpcTbWeight(lastMessage.mpcTbWeight);
      if (typeof lastMessage.mpcTeWeight === "number") setMpcTeWeight(lastMessage.mpcTeWeight);
      if (typeof lastMessage.mpcMoveHeaterWeight === "number") setMpcMoveHeaterWeight(lastMessage.mpcMoveHeaterWeight);
      if (typeof lastMessage.mpcMoveFanWeight === "number") setMpcMoveFanWeight(lastMessage.mpcMoveFanWeight);
      if (typeof lastMessage.mpcRorWeight === "number") setMpcRorWeight(lastMessage.mpcRorWeight);
      if (typeof lastMessage.mpcHorizon === "number") setMpcHorizon(lastMessage.mpcHorizon);
    }
    if (typeof lastMessage.pidDelayFan === "number" && typeof lastMessage.pidDelayHeater === "number") {
      if (!delayInputsDirty.current) {
        setDelayFan(lastMessage.pidDelayFan);
        setDelayHeater(lastMessage.pidDelayHeater);
      } else {
        const delayFanMatches = Math.abs(lastMessage.pidDelayFan - delayFan) < 0.01;
        const delayHeaterMatches = Math.abs(lastMessage.pidDelayHeater - delayHeater) < 0.01;
        if (delayFanMatches && delayHeaterMatches) {
          delayInputsDirty.current = false;
        }
      }
    }
    if (typeof lastMessage.pidProcessDelaySec === "number") setProcessDelaySec(lastMessage.pidProcessDelaySec);

    if (typeof lastMessage.ET === "number" && typeof lastMessage.BT === "number" && typeof lastMessage.simBT === "number") {
      setHistory((prev) => [...prev, { ET: lastMessage.ET, BT: lastMessage.BT, simBT: Number(lastMessage.simBT) }].slice(-300));
    }
    wasPidAutotuneRunning.current = pidAutotuneRunning;
    wasAdrcAutotuneRunning.current = adrcAutotuneRunning;
  }, [
    adrcB0,
    adrcFanControlEnabled,
    adrcScheduleEnabled,
    adrcW0,
    adrcWc,
    legacyTuneMode,
    controlFanMax,
    controlFanMin,
    controlMode,
    delayFan,
    delayHeater,
    kd,
    ki,
    lastMessage,
    maxHeaterPwm,
    minHeaterPwm,
  ]);

  const delayElapsedSec =
    typeof lastMessage?.pidDelayMeasureElapsedSec === "number" ? lastMessage.pidDelayMeasureElapsedSec.toFixed(1) : "0.0";
  const measuredDelaySec =
    typeof lastMessage?.pidMeasuredProcessDelaySec === "number" ? lastMessage.pidMeasuredProcessDelaySec : processDelaySec;
  const noBeanState = lastMessage?.noBeanIdentificationState ?? "idle";
  const noBeanRunning = noBeanState === "baseline" || noBeanState === "heater_step" || noBeanState === "fan_step";
  const legacyTuneRunning = Boolean(lastMessage?.pidAutotune || lastMessage?.adrcAutotune);
  const isTuneRunning = noBeanRunning || legacyTuneRunning;
  const tuneProgress = useBeanLoadedTune
    ? legacyTuneMode === "adrc"
      ? `ADRC ${lastMessage?.adrcAutotunePhase ?? "idle"} • ${formatValue(lastMessage?.adrcAutotuneElapsedSec, 1)}s`
      : `Crossings ${lastMessage?.pidAutotuneCrossings ?? 0}/${lastMessage?.pidAutotuneTargetCrossings ?? "?"}`
    : `${noBeanState} • ${formatValue(lastMessage?.noBeanIdentificationElapsedSec, 1)}s`;

  return (
    <div class="section">
      <h2>Controller Tuning</h2>
      <div class="status-strip">
        Controller {controlMode.toUpperCase()} • Tuning: {isTuneRunning ? "Running" : "Idle"} • {tuneProgress}
      </div>
      <AutotuneGraph history={history} target={target} setpoint={setpoint} />
      <div class="autotune-memos">
        <article class="memo-card">
          <h3>{controlMode.toUpperCase()} tuning</h3>
          <p>{modeMemo(controlMode)}</p>
          <p>No-bean tuning is the default. The bean-loaded relay/step routine is available only when the option below is enabled.</p>
        </article>
      </div>
      <div class="controller-diagnostics">
        <h3>Tuning values</h3>
        <div class="pid-grid">
          <span>Kp {formatValue(lastMessage?.pidKpActive ?? kp, 4)}</span>
          <span>Ki {formatValue(lastMessage?.pidKiActive ?? ki, 4)}</span>
          <span>Kd {formatValue(lastMessage?.pidKdActive ?? kd, 4)}</span>
          <span>Ku {formatValue(lastMessage?.pidAutotuneKu, 4)}</span>
          <span>Pu {formatValue(lastMessage?.pidAutotunePu, 2)}s</span>
          <span>Peaks {formatValue(lastMessage?.pidAutotuneAvgPeakLow, 2)} / {formatValue(lastMessage?.pidAutotuneAvgPeakHigh, 2)}</span>
          <span>b0 {formatValue(lastMessage?.adrcB0 ?? adrcB0, 4)}</span>
          <span>w0 {formatValue(lastMessage?.adrcW0 ?? adrcW0, 4)}</span>
          <span>wc {formatValue(lastMessage?.adrcWc ?? adrcWc, 4)}</span>
          <span>ADRC slope {formatValue(lastMessage?.adrcAutotunePeakSlope, 4)} °C/s</span>
          <span>ADRC baseline {formatValue(lastMessage?.adrcAutotuneBaselineTemp, 2)} °C</span>
          <span>Step {formatValue(lastMessage?.adrcAutotuneHeaterStep, 0)}%</span>
          <span>dT {formatValue(lastMessage?.dT, 2)} °C</span>
          <span>RoR {formatValue(lastMessage?.RoR, 2)} °C/min</span>
          <span>Alarms {lastMessage?.controlAlarmSummary ?? "none"}</span>
          <span>Fuzzy eT scale {formatValue(lastMessage?.fuzzyETScale ?? fuzzyETScale, 2)}</span>
          <span>Fuzzy eRoR scale {formatValue(lastMessage?.fuzzyERorScale ?? fuzzyERorScale, 2)}</span>
          <span>Fuzzy dT {formatValue(lastMessage?.fuzzyDTLow ?? fuzzyDTLow, 1)} / {formatValue(lastMessage?.fuzzyDTHigh ?? fuzzyDTHigh, 1)}</span>
          <span>MPC BT/ET weight {formatValue(lastMessage?.mpcTbWeight ?? mpcTbWeight, 2)} / {formatValue(lastMessage?.mpcTeWeight ?? mpcTeWeight, 2)}</span>
          <span>MPC move H/F {formatValue(lastMessage?.mpcMoveHeaterWeight ?? mpcMoveHeaterWeight, 2)} / {formatValue(lastMessage?.mpcMoveFanWeight ?? mpcMoveFanWeight, 2)}</span>
          <span>MPC horizon {formatValue(lastMessage?.mpcHorizon ?? mpcHorizon, 0)}</span>
          <span>No-bean {lastMessage?.noBeanIdentificationState ?? "idle"} {formatValue(lastMessage?.noBeanIdentificationElapsedSec, 1)}s</span>
          <span>No-bean lag {formatValue(lastMessage?.noBeanLagSec, 2)}s</span>
          <span>No-bean H gain {formatValue(lastMessage?.noBeanGainTbPerHeater, 4)} / {formatValue(lastMessage?.noBeanGainTePerHeater, 4)}</span>
          <span>No-bean F gain {formatValue(lastMessage?.noBeanGainTbPerFan, 4)} / {formatValue(lastMessage?.noBeanGainTePerFan, 4)}</span>
          <span>No-bean ADRC {formatValue(lastMessage?.noBeanSuggestedAdrcB0, 4)} / {formatValue(lastMessage?.noBeanSuggestedAdrcW0, 3)} / {formatValue(lastMessage?.noBeanSuggestedAdrcWc, 3)}</span>
        </div>
      </div>
      <div class="form-grid">
        <label>Target</label>
        <select value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value as PidTarget)}>
          <option value="BT">BT</option><option value="ET">ET</option><option value="simBT">Sim BT</option>
        </select>
        <label>Method</label>
        <select value={method} onChange={(e) => setMethod((e.target as HTMLSelectElement).value as PidMethod)}>
          <option value="ziegler-nichols">Ziegler–Nichols</option><option value="tyreus-luyben">Tyreus–Luyben</option>
          <option value="pessen-integral">Pessen Integral</option><option value="no-overshoot">No overshoot</option>
        </select>
        <label>Control mode</label>
        <select
          value={controlMode}
          onChange={(e) => {
            controlModeDirty.current = true;
            setControlMode((e.target as HTMLSelectElement).value as ControlMode);
          }}
        >
          <option value="pid">PID</option><option value="adrc">ADRC</option><option value="fuzzy">Fuzzy</option><option value="mpc">MPC</option>
        </select>
        <label>Bean-loaded tune</label>
        <input type="checkbox" checked={useBeanLoadedTune} onChange={(e) => setUseBeanLoadedTune(e.currentTarget.checked)} />
        {useBeanLoadedTune && (
          <>
            <label>Legacy routine</label>
            <select
              value={legacyTuneMode}
              onChange={(e) => {
                legacyTuneModeDirty.current = true;
                setLegacyTuneMode((e.target as HTMLSelectElement).value as LegacyTuneMode);
              }}
            >
              <option value="pid">PID relay</option><option value="adrc">ADRC step</option>
            </select>
          </>
        )}
        <label>Setpoint</label>
        <input type="number" value={setpoint} onInput={(e) => setSetpoint(Number((e.target as HTMLInputElement).value) || 0)} />
        <label>Fan</label>
        <input type="number" value={fanSpeed} onInput={(e) => setFanSpeed(Number((e.target as HTMLInputElement).value) || 0)} />
        <label>Auto fan min / max</label>
        <div class="pid-inline-inputs">
          <input
            type="number"
            value={controlFanMin}
            onInput={(e) => {
              controlFanBoundsDirty.current = true;
              setControlFanMin(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            value={controlFanMax}
            onInput={(e) => {
              controlFanBoundsDirty.current = true;
              setControlFanMax(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
        </div>
        <label>ADRC controls fan</label>
        <input
          type="checkbox"
          checked={adrcFanControlEnabled}
          onChange={(e) => {
            adrcFanControlDirty.current = true;
            setAdrcFanControlEnabled(e.currentTarget.checked);
          }}
        />
        <label>Min PWM</label>
        <input
          type="number"
          value={minHeaterPwm}
          onInput={(e) => {
            autotuneBoundsDirty.current = true;
            setMinHeaterPwm(Number((e.target as HTMLInputElement).value) || 0);
          }}
        />
        <label>Max PWM</label>
        <input
          type="number"
          value={maxHeaterPwm}
          onInput={(e) => {
            autotuneBoundsDirty.current = true;
            setMaxHeaterPwm(Number((e.target as HTMLInputElement).value) || 0);
          }}
        />
        <label>Kp / Ki / Kd</label>
        <div class="pid-inline-inputs">
          <input type="number" value={kp} onInput={(e) => setKp(Number((e.target as HTMLInputElement).value) || 0)} />
          <input type="number" value={ki} onInput={(e) => setKi(Number((e.target as HTMLInputElement).value) || 0)} />
          <input type="number" value={kd} onInput={(e) => setKd(Number((e.target as HTMLInputElement).value) || 0)} />
        </div>
        <label>b0 / w0 / wc</label>
        <div class="pid-inline-inputs">
          <input
            type="number"
            value={adrcB0}
            onInput={(e) => {
              adrcValuesDirty.current = true;
              setAdrcB0(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            value={adrcW0}
            onInput={(e) => {
              adrcValuesDirty.current = true;
              setAdrcW0(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            value={adrcWc}
            onInput={(e) => {
              adrcValuesDirty.current = true;
              setAdrcWc(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
        </div>
        <label>ADRC schedule</label>
        <input
          checked={adrcScheduleEnabled}
          type="checkbox"
          onChange={(e) => {
            adrcScheduleDirty.current = true;
            setAdrcScheduleEnabled(e.currentTarget.checked);
          }}
        />
        <label>Slew heater / fan</label>
        <div class="pid-inline-inputs">
          <input
            type="number"
            value={heaterSlew}
            onInput={(e) => {
              frameworkValuesDirty.current = true;
              setHeaterSlew(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            value={fanSlew}
            onInput={(e) => {
              frameworkValuesDirty.current = true;
              setFanSlew(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
        </div>
        <label>Filter BT / ET</label>
        <div class="pid-inline-inputs">
          <input
            type="number"
            step="0.01"
            value={tbFilterAlpha}
            onInput={(e) => {
              frameworkValuesDirty.current = true;
              setTbFilterAlpha(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            step="0.01"
            value={teFilterAlpha}
            onInput={(e) => {
              frameworkValuesDirty.current = true;
              setTeFilterAlpha(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
        </div>
        <label>Filter dT / RoR</label>
        <div class="pid-inline-inputs">
          <input
            type="number"
            step="0.01"
            value={dtFilterAlpha}
            onInput={(e) => {
              frameworkValuesDirty.current = true;
              setDTFilterAlpha(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            step="0.01"
            value={rorFilterAlpha}
            onInput={(e) => {
              frameworkValuesDirty.current = true;
              setRorFilterAlpha(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
        </div>
        <label>PID derivative / Smith</label>
        <div class="pid-inline-inputs">
          <input
            type="number"
            step="0.01"
            value={pidDerivativeAlpha}
            onInput={(e) => {
              pidSmithValuesDirty.current = true;
              setPidDerivativeAlpha(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            step="0.001"
            value={pidSmithGain}
            onInput={(e) => {
              pidSmithValuesDirty.current = true;
              setPidSmithGain(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            value={pidSmithTau}
            onInput={(e) => {
              pidSmithValuesDirty.current = true;
              setPidSmithTau(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
        </div>
        <label>Fuzzy eT / eRoR</label>
        <div class="pid-inline-inputs">
          <input
            type="number"
            value={fuzzyETScale}
            onInput={(e) => {
              fuzzyValuesDirty.current = true;
              setFuzzyETScale(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            value={fuzzyERorScale}
            onInput={(e) => {
              fuzzyValuesDirty.current = true;
              setFuzzyERorScale(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
        </div>
        <label>Fuzzy dT low / high</label>
        <div class="pid-inline-inputs">
          <input
            type="number"
            value={fuzzyDTLow}
            onInput={(e) => {
              fuzzyValuesDirty.current = true;
              setFuzzyDTLow(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            value={fuzzyDTHigh}
            onInput={(e) => {
              fuzzyValuesDirty.current = true;
              setFuzzyDTHigh(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
        </div>
        <label>Fuzzy heater / fan step</label>
        <div class="pid-inline-inputs">
          <input
            type="number"
            value={fuzzyHeaterStepScale}
            onInput={(e) => {
              fuzzyValuesDirty.current = true;
              setFuzzyHeaterStepScale(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            value={fuzzyFanStepScale}
            onInput={(e) => {
              fuzzyValuesDirty.current = true;
              setFuzzyFanStepScale(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
        </div>
        <label>MPC BT / ET / RoR</label>
        <div class="pid-inline-inputs">
          <input
            type="number"
            step="0.01"
            value={mpcTbWeight}
            onInput={(e) => {
              mpcValuesDirty.current = true;
              setMpcTbWeight(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            step="0.01"
            value={mpcTeWeight}
            onInput={(e) => {
              mpcValuesDirty.current = true;
              setMpcTeWeight(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            step="0.01"
            value={mpcRorWeight}
            onInput={(e) => {
              mpcValuesDirty.current = true;
              setMpcRorWeight(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
        </div>
        <label>MPC move H / F / horizon</label>
        <div class="pid-inline-inputs">
          <input
            type="number"
            step="0.01"
            value={mpcMoveHeaterWeight}
            onInput={(e) => {
              mpcValuesDirty.current = true;
              setMpcMoveHeaterWeight(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            step="0.01"
            value={mpcMoveFanWeight}
            onInput={(e) => {
              mpcValuesDirty.current = true;
              setMpcMoveFanWeight(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            value={mpcHorizon}
            onInput={(e) => {
              mpcValuesDirty.current = true;
              setMpcHorizon(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
        </div>
        <label>No-bean fan / fan step</label>
        <div class="pid-inline-inputs">
          <input type="number" value={noBeanFan} onInput={(e) => setNoBeanFan(Number((e.target as HTMLInputElement).value) || 0)} />
          <input type="number" value={noBeanFanHigh} onInput={(e) => setNoBeanFanHigh(Number((e.target as HTMLInputElement).value) || 0)} />
        </div>
        <label>No-bean heat low / high</label>
        <div class="pid-inline-inputs">
          <input type="number" value={noBeanHeaterLow} onInput={(e) => setNoBeanHeaterLow(Number((e.target as HTMLInputElement).value) || 0)} />
          <input type="number" value={noBeanHeaterHigh} onInput={(e) => setNoBeanHeaterHigh(Number((e.target as HTMLInputElement).value) || 0)} />
        </div>
        <label>No-bean baseline / step s</label>
        <div class="pid-inline-inputs">
          <input type="number" value={noBeanBaselineSec} onInput={(e) => setNoBeanBaselineSec(Number((e.target as HTMLInputElement).value) || 0)} />
          <input type="number" value={noBeanStepSec} onInput={(e) => setNoBeanStepSec(Number((e.target as HTMLInputElement).value) || 0)} />
        </div>
        <label>Delay fan / heater</label>
        <div class="pid-inline-inputs">
          <input
            type="number"
            value={delayFan}
            onInput={(e) => {
              delayInputsDirty.current = true;
              setDelayFan(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
          <input
            type="number"
            value={delayHeater}
            onInput={(e) => {
              delayInputsDirty.current = true;
              setDelayHeater(Number((e.target as HTMLInputElement).value) || 0);
            }}
          />
        </div>
        <label>Measured delay (s)</label>
        <input type="number" value={processDelaySec} onInput={(e) => setProcessDelaySec(Number((e.target as HTMLInputElement).value) || 0)} />
      </div>
      <div class="inline-actions">
        <button
          onClick={() => {
            const fanBounds = normalizeFanBounds(controlFanMin, controlFanMax);
            setControlFanMin(fanBounds.min);
            setControlFanMax(fanBounds.max);
            if (legacyTuneMode === "adrc") {
              adrcValuesDirty.current = false;
            }
            const low = Math.min(fuzzyDTLow, fuzzyDTHigh);
            const high = Math.max(fuzzyDTLow, fuzzyDTHigh);
            sendCommand({
              id: 1,
              command: "setPidControl",
              FanVal: fanSpeed,
              pidEnabled: false,
              controlMode,
              autotuneMode: legacyTuneMode,
              pidTarget: target,
              pidTuneMethod: method,
              controlFanMin: fanBounds.min,
              controlFanMax: fanBounds.max,
              adrcFanControlEnabled,
              adrcScheduleEnabled,
              setpoint,
              controlHeaterSlewPerSec: heaterSlew,
              controlFanSlewPerSec: fanSlew,
              filterTbAlpha: clampUnit(tbFilterAlpha),
              filterTeAlpha: clampUnit(teFilterAlpha),
              filterDTAlpha: clampUnit(dtFilterAlpha),
              filterRorAlpha: clampUnit(rorFilterAlpha),
              pidDerivativeFilterAlpha: clampUnit(pidDerivativeAlpha),
              pidSmithModelGain: pidSmithGain,
              pidSmithModelTauSec: pidSmithTau,
              fuzzyETScale,
              fuzzyERorScale,
              fuzzyDTLow: low,
              fuzzyDTHigh: high,
              fuzzyHeaterStepScale,
              fuzzyFanStepScale,
              mpcTbWeight,
              mpcTeWeight,
              mpcMoveHeaterWeight,
              mpcMoveFanWeight,
              mpcRorWeight,
              mpcHorizon: Math.round(mpcHorizon),
              pidAutotuneMin: minHeaterPwm,
              pidAutotuneMax: maxHeaterPwm,
              pidAutotune: useBeanLoadedTune && legacyTuneMode === "pid",
              adrcAutotune: useBeanLoadedTune && legacyTuneMode === "adrc",
            });
            if (!useBeanLoadedTune) {
              sendCommand({
                id: 1,
                command: "startNoBeanIdentification",
                fan: noBeanFan,
                heaterLow: noBeanHeaterLow,
                heaterHigh: noBeanHeaterHigh,
                fanHigh: noBeanFanHigh,
                baselineSec: noBeanBaselineSec,
                stepSec: noBeanStepSec,
              });
            }
            setAutotuneLog([useBeanLoadedTune ? `Bean-loaded tune requested (${legacyTuneMode.toUpperCase()})` : `No-bean tuning requested (${controlMode.toUpperCase()})`]);
            autotuneStopRequested.current = false;
          }}
        >
          Start Tuning
        </button>
        <button
          onClick={() => {
            autotuneStopRequested.current = true;
            sendCommand({ id: 1, command: "setPidControl", pidAutotune: false, adrcAutotune: false });
            sendCommand({ id: 1, command: "stopNoBeanIdentification" });
          }}
        >
          Stop Tuning
        </button>
        <button onClick={() => sendCommand({ id: 1, command: "setFan", value: 0 })}>Fan Off</button>
        <button
          onClick={() => {
            sendCommand({ id: 1, command: "setPreferences", pidTarget: target, pidKp: kp, pidKi: ki, pidKd: kd });
            window.dispatchEvent(
              new CustomEvent("pid-preferences-updated", {
                detail: { kp, ki, kd, pidTarget: target },
              }),
            );
            setAutotuneLog((prev) => [...prev.slice(-24), `Applied PID: Kp ${kp.toFixed(3)}, Ki ${ki.toFixed(3)}, Kd ${kd.toFixed(3)}`]);
          }}
        >
          Apply PID
        </button>
        <button
          onClick={() => {
            const fanBounds = normalizeFanBounds(controlFanMin, controlFanMax);
            setControlFanMin(fanBounds.min);
            setControlFanMax(fanBounds.max);
            sendCommand({
              id: 1,
              command: "setPidControl",
              controlMode: "adrc",
              controlFanMin: fanBounds.min,
              controlFanMax: fanBounds.max,
              adrcFanControlEnabled,
              adrcScheduleEnabled,
              adrcB0,
              adrcW0,
              adrcWc,
            });
            adrcValuesDirty.current = true;
            setAutotuneLog((prev) => [...prev.slice(-24), `Applied ADRC: b0 ${adrcB0.toFixed(4)}, w0 ${adrcW0.toFixed(4)}, wc ${adrcWc.toFixed(4)}`]);
          }}
        >
          Apply ADRC
        </button>
        <button
          onClick={() => {
            sendCommand({
              id: 1,
              command: "setPidControl",
              controlHeaterSlewPerSec: heaterSlew,
              controlFanSlewPerSec: fanSlew,
              filterTbAlpha: clampUnit(tbFilterAlpha),
              filterTeAlpha: clampUnit(teFilterAlpha),
              filterDTAlpha: clampUnit(dtFilterAlpha),
              filterRorAlpha: clampUnit(rorFilterAlpha),
              pidDerivativeFilterAlpha: clampUnit(pidDerivativeAlpha),
              pidSmithModelGain: pidSmithGain,
              pidSmithModelTauSec: pidSmithTau,
            });
            frameworkValuesDirty.current = true;
            pidSmithValuesDirty.current = true;
            setAutotuneLog((prev) => [...prev.slice(-24), "Applied shared filters, slew limits, and Smith/PID model values"]);
          }}
        >
          Apply Shared
        </button>
        <button
          onClick={() => {
            const low = Math.min(fuzzyDTLow, fuzzyDTHigh);
            const high = Math.max(fuzzyDTLow, fuzzyDTHigh);
            setFuzzyDTLow(low);
            setFuzzyDTHigh(high);
            sendCommand({
              id: 1,
              command: "setPidControl",
              controlMode: "fuzzy",
              fuzzyETScale,
              fuzzyERorScale,
              fuzzyDTLow: low,
              fuzzyDTHigh: high,
              fuzzyHeaterStepScale,
              fuzzyFanStepScale,
            });
            fuzzyValuesDirty.current = true;
            setAutotuneLog((prev) => [...prev.slice(-24), "Applied fuzzy ranges and output scaling"]);
          }}
        >
          Apply Fuzzy
        </button>
        <button
          onClick={() => {
            sendCommand({
              id: 1,
              command: "setPidControl",
              controlMode: "mpc",
              mpcTbWeight,
              mpcTeWeight,
              mpcMoveHeaterWeight,
              mpcMoveFanWeight,
              mpcRorWeight,
              mpcHorizon: Math.round(mpcHorizon),
            });
            mpcValuesDirty.current = true;
            setAutotuneLog((prev) => [...prev.slice(-24), "Applied MPC tracking weights, move penalties, and horizon"]);
          }}
        >
          Apply MPC
        </button>
        <button
          onClick={() => {
            sendCommand({
              id: 1,
              command: "setPidControl",
              pidEnabled: false,
              pidDelayFan: delayFan,
              pidDelayHeater: delayHeater,
              pidMeasureDelay: true,
            });
            setAutotuneLog((prev) => [...prev.slice(-24), "Delay measurement requested (10s stabilize + heater step)"]);
          }}
        >
          Measure Delay
        </button>
        <button
          onClick={() => {
            sendCommand({
              id: 1,
              command: "setPidControl",
              pidProcessDelaySec: processDelaySec,
              pidPredictorEnabled: true,
            });
            setAutotuneLog((prev) => [...prev.slice(-24), `Applied process delay: ${processDelaySec.toFixed(2)}s`]);
          }}
        >
          Apply Delay
        </button>
      </div>
      <div class="status-strip">
        Delay measure: {lastMessage?.pidDelayMeasureState ?? "idle"} • elapsed {delayElapsedSec}s • measured {measuredDelaySec}s
      </div>
      <pre class="log-console">{autotuneLog.slice(-25).join("\n")}</pre>
    </div>
  );
}

function formatValue(value: number | null | undefined, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "N/A";
}

function modeMemo(mode: ControlMode) {
  switch (mode) {
    case "adrc":
      return "Empty-roaster tuning measures delay and slope, then seeds b0, observer bandwidth, controller bandwidth, and the fan/heat schedule.";
    case "fuzzy":
      return "Empty-roaster tuning seeds BT error range, RoR error range, dT window, and conservative heater/fan step sizes.";
    case "mpc":
      return "Empty-roaster tuning seeds the 2x2 BT/ET model from heater and fan response, while the weights below shape tracking versus smooth commands.";
    default:
      return "Empty-roaster tuning measures command lag and coarse thermal response for PID and the Smith predictor.";
  }
}

function normalizeFanBounds(min: number, max: number) {
  const safeMin = clampPercent(min);
  const safeMax = clampPercent(max);
  return {
    min: Math.min(safeMin, safeMax),
    max: Math.max(safeMin, safeMax),
  };
}

function clampPercent(value: number) {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}

function clampUnit(value: number) {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
