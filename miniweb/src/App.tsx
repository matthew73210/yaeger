import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  type ChartData,
} from "chart.js";
import { getBasicAuthHeaderValue } from "./auth";
import type { YaegerMessage } from "./model";
import { connectionStatus, lastMessage, lastUpdate, sendCommand, type Signal } from "./websocket";

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

declare const __APP_VERSION__: string;
declare const __BUILD_TIMESTAMP__: string;

type AppTab = "home" | "roast" | "autotune" | "logs" | "settings";

type RoastCommand = { type: "fan" | "heater"; value: number; timestamp: Date };
type RoastEvent = { label: string; timestamp: Date; ET: number; BT: number };
type RoastMeasurement = { timestamp: Date; message: YaegerMessage };

interface DeviceInfo {
  firmwareVersion: string;
  networkMode: string;
  ssid: string;
  ip: string;
  hostname: string;
  csrfToken?: string;
}

function useSignalValue<T>(signal: Signal<T>): T {
  const [value, setValue] = useState(signal.val);
  useEffect(() => signal.subscribe(setValue), [signal]);
  return value;
}

function useRoastChart(measurements: RoastMeasurement[]) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<"line"> | null>(null);

  useEffect(() => {
    if (!canvasRef.current || chartRef.current) return;

    chartRef.current = new Chart<"line">(canvasRef.current, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          { label: "ET", data: [], borderColor: "#f97316", tension: 0.2 },
          { label: "BT", data: [], borderColor: "#3b82f6", tension: 0.2 },
          { label: "simBT", data: [], borderColor: "#8b5cf6", tension: 0.2 },
        ],
      },
      options: { responsive: true, animation: false, scales: { y: { title: { display: true, text: "°C" } } } },
    });

    return () => chartRef.current?.destroy();
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    const chart = chartRef.current;
    const labels = measurements.map((m) => m.timestamp.toLocaleTimeString());
    const et = measurements.map((m) => m.message.ET);
    const bt = measurements.map((m) => m.message.BT);
    const sim = measurements.map((m) => m.message.simBT ?? null);

    const data: ChartData<"line"> = {
      labels,
      datasets: [
        { ...chart.data.datasets[0], data: et },
        { ...chart.data.datasets[1], data: bt },
        { ...chart.data.datasets[2], data: sim },
      ],
    };

    chart.data = data;
    chart.update();
  }, [measurements]);

  return canvasRef;
}

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const status = useSignalValue(connectionStatus);
  const message = useSignalValue(lastMessage);
  const updatedAt = useSignalValue(lastUpdate);

  const [ssid, setSsid] = useState("");
  const [pass, setPass] = useState("");
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [deviceInfoError, setDeviceInfoError] = useState<string | null>(null);
  const buildTimestamp = useMemo(() => new Date(__BUILD_TIMESTAMP__).toLocaleString(), []);

  async function refreshDeviceInfo() {
    try {
      setDeviceInfoError(null);
      const response = await fetch(`http://${location.host}/api/info`);
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      setDeviceInfo((await response.json()) as DeviceInfo);
    } catch (error) {
      setDeviceInfo(null);
      setDeviceInfoError(error instanceof Error ? error.message : "Unknown error");
    }
  }

  useEffect(() => {
    void refreshDeviceInfo();
  }, []);

  async function updateWifiSettings() {
    const response = await fetch(`http://${location.host}/api/wifi`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: getBasicAuthHeaderValue(),
        "X-Yaeger-CSRF": deviceInfo?.csrfToken ?? "",
      },
      body: JSON.stringify({ ssid, pass }),
    });

    if (response.ok) {
      alert("Wi-Fi settings updated. Restart device to apply.");
      await refreshDeviceInfo();
    } else {
      alert(`Failed to update Wi-Fi: ${response.status}`);
    }
  }

  return (
    <div class="app-layout">
      <div class="tabs-nav">
        <h2 class="tabs-title">Yaeger</h2>
        <button class={`tab-btn ${activeTab === "home" ? "active" : ""}`} onClick={() => setActiveTab("home")}>Home</button>
        <button class={`tab-btn ${activeTab === "roast" ? "active" : ""}`} onClick={() => setActiveTab("roast")}>Roast</button>
        <button class={`tab-btn ${activeTab === "autotune" ? "active" : ""}`} onClick={() => setActiveTab("autotune")}>Autotune</button>
        <button class={`tab-btn ${activeTab === "logs" ? "active" : ""}`} onClick={() => setActiveTab("logs")}>Logs</button>
        <button class={`tab-btn ${activeTab === "settings" ? "active" : ""}`} onClick={() => setActiveTab("settings")}>Settings</button>
      </div>

      <div class="tab-content">
        {activeTab === "home" && <HomeTab status={status} message={message} updatedAt={updatedAt} />}
        {activeTab === "roast" && <RoastTab message={message} updatedAt={updatedAt} />}
        {activeTab === "autotune" && <AutotuneTab message={message} />}
        {activeTab === "logs" && <LogsTab />}
        {activeTab === "settings" && <SettingsTab appVersion={__APP_VERSION__} buildTimestamp={buildTimestamp} deviceInfo={deviceInfo} deviceInfoError={deviceInfoError} refreshDeviceInfo={refreshDeviceInfo} ssid={ssid} pass={pass} setSsid={setSsid} setPass={setPass} updateWifiSettings={updateWifiSettings} />}
      </div>
    </div>
  );
}

function HomeTab({ status, message, updatedAt }: { status: string; message: YaegerMessage | null; updatedAt: Date | null }) {
  return <div class="section"><h2>Status</h2><p>Connection: {status}</p><p>ET: {message?.ET ?? "N/A"}°C</p><p>BT: {message?.BT ?? "N/A"}°C</p><p>Last update: {updatedAt?.toLocaleTimeString() ?? "N/A"}</p></div>;
}

function RoastTab({ message, updatedAt }: { message: YaegerMessage | null; updatedAt: Date | null }) {
  const [isRoasting, setIsRoasting] = useState(false);
  const [measurements, setMeasurements] = useState<RoastMeasurement[]>([]);
  const [events, setEvents] = useState<RoastEvent[]>([]);
  const [commands, setCommands] = useState<RoastCommand[]>([]);
  const [fan, setFan] = useState(50);
  const [heater, setHeater] = useState(50);
  const [setpoint, setSetpoint] = useState(200);
  const [pidEnabled, setPidEnabled] = useState(false);
  const [pidTarget, setPidTarget] = useState<"BT" | "ET" | "simBT">("BT");
  const [pidKp, setPidKp] = useState(1);
  const [pidKi, setPidKi] = useState(0.1);
  const [pidKd, setPidKd] = useState(0.01);
  const chartRef = useRoastChart(measurements);

  useEffect(() => {
    if (!message || !updatedAt) return;
    setFan(message.FanVal);
    setHeater(message.BurnerVal);
    if (isRoasting) {
      setMeasurements((prev) => [...prev, { timestamp: updatedAt, message }].slice(-300));
    }
  }, [message, updatedAt, isRoasting]);

  const btRoR = useMemo(() => {
    if (measurements.length < 2) return null;
    const a = measurements[measurements.length - 2];
    const b = measurements[measurements.length - 1];
    const dt = (b.timestamp.getTime() - a.timestamp.getTime()) / 1000;
    if (dt <= 0) return null;
    return ((b.message.BT - a.message.BT) / dt) * 60;
  }, [measurements]);

  const etRoR = useMemo(() => {
    if (measurements.length < 2) return null;
    const a = measurements[measurements.length - 2];
    const b = measurements[measurements.length - 1];
    const dt = (b.timestamp.getTime() - a.timestamp.getTime()) / 1000;
    if (dt <= 0) return null;
    return ((b.message.ET - a.message.ET) / dt) * 60;
  }, [measurements]);

  const roastTime = useMemo(() => {
    if (measurements.length < 2) return "00:00";
    const start = measurements[0].timestamp.getTime();
    const end = measurements[measurements.length - 1].timestamp.getTime();
    const totalSec = Math.max(0, Math.floor((end - start) / 1000));
    const m = Math.floor(totalSec / 60).toString().padStart(2, "0");
    const s = (totalSec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }, [measurements]);

  const appendCommand = (type: "fan" | "heater", value: number) => {
    if (!isRoasting) return;
    setCommands((prev) => [...prev, { type, value, timestamp: new Date() }]);
  };

  const appendEvent = (label: string) => {
    if (!isRoasting || !message) return;
    setEvents((prev) => [...prev, { label, timestamp: new Date(), ET: message.ET, BT: message.BT }]);
  };

  const toggleRoast = () => {
    if (!isRoasting) {
      setIsRoasting(true);
      setMeasurements([]);
      setEvents([]);
      setCommands([]);
      sendCommand({ id: 1, command: "startRoast" });
    } else {
      setIsRoasting(false);
      sendCommand({ id: 1, command: "endRoast" });
    }
  };

  const downloadRoast = () => {
    const blob = new Blob([JSON.stringify({ measurements, events, commands })], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "roast.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const uploadRoast = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const parsedMeasurements = (parsed.measurements ?? []).map((m: any) => ({ timestamp: new Date(m.timestamp), message: m.message }));
        setMeasurements(parsedMeasurements);
        setEvents((parsed.events ?? []).map((e: any) => ({ ...e, timestamp: new Date(e.timestamp) })));
        setCommands((parsed.commands ?? []).map((c: any) => ({ ...c, timestamp: new Date(c.timestamp) })));
      } catch {
        alert("Invalid roast file");
      }
    };
    reader.readAsText(file);
  };

  const sendPidConfig = () => {
    sendCommand({ id: 1, command: "setPreferences", pidTarget, pidKp, pidKi, pidKd });
    sendCommand({ id: 1, command: "setPidControl", setpoint, pidEnabled, pidTarget });
  };

  return (
    <div class="section">
      <h2>Roast</h2>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button onClick={toggleRoast}>{isRoasting ? "Stop" : "Start"}</button>
        <button onClick={downloadRoast} disabled={isRoasting || measurements.length === 0}>Download</button>
        <label class="tab-btn" style={{ cursor: "pointer" }}>Upload<input type="file" accept="application/json" style={{ display: "none" }} onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) uploadRoast(f); }} /></label>
        <span>Roast time: {roastTime}</span>
      </div>

      <canvas ref={chartRef} height={180} style={{ marginTop: "0.75rem" }} />

      <div class="control_cluster">
        <div>Setpoint {setpoint}°C <input type="range" min={0} max={300} value={setpoint} onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); setSetpoint(v); sendCommand({ id: 1, command: "setPidControl", setpoint: v, pidEnabled, pidTarget }); }} /></div>
        <div>Fan {fan}% <input type="range" min={0} max={100} step={5} value={fan} onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); setFan(v); sendCommand({ id: 1, FanVal: v }); appendCommand("fan", v); }} /></div>
        <div>Heater {heater}% <input type="range" min={0} max={100} step={5} value={heater} disabled={pidEnabled} onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); setHeater(v); sendCommand({ id: 1, BurnerVal: v }); appendCommand("heater", v); }} /></div>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
        {['charge','dry-end','first-crack-start','first-crack-end','second-crack-start','second-crack-end','drop'].map((label) => (
          <button key={label} onClick={() => appendEvent(label)}>{label}</button>
        ))}
      </div>

      <p>ET: {message?.ET ?? 'N/A'} | BT: {message?.BT ?? 'N/A'} | Sim BT: {message?.simBT?.toFixed(1) ?? 'N/A'} | BT RoR: {btRoR?.toFixed(2) ?? 'N/A'} | ET RoR: {etRoR?.toFixed(2) ?? 'N/A'}</p>
      <p>Last update: {updatedAt?.toString() ?? 'N/A'}</p>
      <p>PID live: Temp {message?.pidCurrentTemp?.toFixed(2) ?? 'N/A'} | Error {message?.pidError?.toFixed(2) ?? 'N/A'} | Integral {message?.pidIntegral?.toFixed(2) ?? 'N/A'} | Derivative {message?.pidDerivative?.toFixed(2) ?? 'N/A'} | Output {message?.pidOutput?.toFixed(2) ?? 'N/A'}</p>

      <h3>PID Config</h3>
      <div class="form-grid">
        <label>P</label><input type="number" value={pidKp} onInput={(e) => setPidKp(Number((e.target as HTMLInputElement).value))} />
        <label>I</label><input type="number" value={pidKi} onInput={(e) => setPidKi(Number((e.target as HTMLInputElement).value))} />
        <label>D</label><input type="number" value={pidKd} onInput={(e) => setPidKd(Number((e.target as HTMLInputElement).value))} />
        <label>Target</label>
        <select value={pidTarget} onInput={(e) => setPidTarget((e.target as HTMLSelectElement).value as "BT" | "ET" | "simBT")}>
          <option value="BT">BT</option><option value="ET">ET</option><option value="simBT">Sim BT</option>
        </select>
      </div>
      <label><input type="checkbox" checked={pidEnabled} onInput={(e) => setPidEnabled((e.target as HTMLInputElement).checked)} /> PID Enabled</label>
      <button onClick={sendPidConfig}>Apply PID</button>
    </div>
  );
}

function AutotuneTab({ message }: { message: YaegerMessage | null }) {
  const [target, setTarget] = useState<"BT" | "ET" | "simBT">("BT");
  const [method, setMethod] = useState<"ziegler-nichols" | "tyreus-luyben" | "pessen-integral" | "no-overshoot">("ziegler-nichols");
  const [setpoint, setSetpoint] = useState(200);
  const [fanSpeed, setFanSpeed] = useState(50);
  const [minHeaterPwm, setMinHeaterPwm] = useState(0);
  const [maxHeaterPwm, setMaxHeaterPwm] = useState(60);

  const submit = (pidAutotune: boolean) => sendCommand({ id: 1, pidAutotune, pidTarget: target, pidTuneMethod: method, setpoint, FanVal: fanSpeed, pidAutotuneMin: minHeaterPwm, pidAutotuneMax: maxHeaterPwm });

  return <div class="section"><h2>PID Autotune</h2><div class="form-grid"><label>Target</label><select value={target} onInput={(e) => setTarget((e.target as HTMLSelectElement).value as "BT" | "ET" | "simBT")}><option value="BT">BT</option><option value="ET">ET</option><option value="simBT">simBT</option></select><label>Method</label><select value={method} onInput={(e) => setMethod((e.target as HTMLSelectElement).value as "ziegler-nichols" | "tyreus-luyben" | "pessen-integral" | "no-overshoot")}><option value="ziegler-nichols">Ziegler-Nichols</option><option value="tyreus-luyben">Tyreus-Luyben</option><option value="pessen-integral">Pessen</option><option value="no-overshoot">No Overshoot</option></select><label>Setpoint</label><input type="number" value={setpoint} onInput={(e) => setSetpoint(Number((e.target as HTMLInputElement).value))} /><label>Fan</label><input type="number" value={fanSpeed} onInput={(e) => setFanSpeed(Number((e.target as HTMLInputElement).value))} /><label>Min Heater</label><input type="number" value={minHeaterPwm} onInput={(e) => setMinHeaterPwm(Number((e.target as HTMLInputElement).value))} /><label>Max Heater</label><input type="number" value={maxHeaterPwm} onInput={(e) => setMaxHeaterPwm(Number((e.target as HTMLInputElement).value))} /></div><p>Active: {message?.pidAutotune ? "Yes" : "No"}</p><p>Crossings: {message?.pidAutotuneCrossings ?? 0}/{message?.pidAutotuneTargetCrossings ?? 0}</p><p>Ku/Pu: {message?.pidAutotuneKu ?? "N/A"}/{message?.pidAutotunePu ?? "N/A"}</p><button onClick={() => submit(true)}>Start Autotune</button> <button onClick={() => submit(false)}>Stop Autotune</button></div>;
}

function LogsTab() {
  const [logs, setLogs] = useState("");
  const [error, setError] = useState("");

  async function refreshLogs() {
    try {
      const response = await fetch(`http://${location.host}/api/logs`, { headers: { Authorization: getBasicAuthHeaderValue() } });
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      setLogs(await response.text());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  }

  return <div class="section"><h2>Logs</h2><button onClick={() => void refreshLogs()}>Refresh Logs</button>{error && <p style={{ color: "#b91c1c" }}>{error}</p>}<textarea readOnly value={logs} rows={18} style={{ width: "100%", marginTop: "1rem" }} /></div>;
}

function SettingsTab(props: { appVersion: string; buildTimestamp: string; deviceInfo: DeviceInfo | null; deviceInfoError: string | null; refreshDeviceInfo: () => Promise<void>; ssid: string; pass: string; setSsid: (value: string) => void; setPass: (value: string) => void; updateWifiSettings: () => Promise<void>; }) {
  return <div class="section"><h2>Settings</h2><p>Web UI version: {props.appVersion}</p><p>Web UI build: {props.buildTimestamp}</p><p>Firmware: {props.deviceInfo?.firmwareVersion ?? "N/A"}</p><p>IP: {props.deviceInfo?.ip ?? "N/A"}</p>{props.deviceInfoError && <p style={{ color: "#b91c1c" }}>{props.deviceInfoError}</p>}<button onClick={() => void props.refreshDeviceInfo()}>Refresh Info</button><div class="form-grid"><label>Wi‑Fi SSID</label><input type="text" value={props.ssid} onInput={(e) => props.setSsid((e.target as HTMLInputElement).value)} /><label>Wi‑Fi Password</label><input type="password" value={props.pass} onInput={(e) => props.setPass((e.target as HTMLInputElement).value)} /></div><button onClick={() => void props.updateWifiSettings()}>Update Wi-Fi</button></div>;
}
