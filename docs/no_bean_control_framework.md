# No-Bean Control Framework

This firmware separates four concerns:

- signal preprocessing: raw BT/ET, filtered BT/ET, `dT = ET - BT`, and filtered RoR from filtered BT
- safety: probe faults, stale or implausible samples, low-flow/fan-stall proxy, runaway temperature, and saturation flags
- control execution: PID/Smith, gain-scheduled ADRC, fuzzy, and lightweight 2x2 MPC
- identification: empty-roaster step data used to seed delay, gains, time constants, ADRC parameters, fuzzy ranges, and MPC models

## Runtime Modes

The existing websocket command remains backward compatible:

```json
{"command":"setPidControl","controlMode":"pid","pidEnabled":true,"setpoint":180}
```

Additional `controlMode` values are:

- `adrc`: heater-dominant ADRC with optional coordinated fan action
- `fuzzy`: rule-based increments for heater and fan
- `mpc`: constrained 2-input/2-output predictive controller using `[uh, uf] -> [BT, ET]`

Important shared fields:

- `controlFanMin`, `controlFanMax`: fan envelope, with `controlFanMin` preserving airflow/lofting
- `controlHeaterSlewPerSec`, `controlFanSlewPerSec`: smooth actuator movement limits
- `tbSetpoint`, `teSetpoint`, `rorSetpoint`: primary BT target plus optional soft ET/RoR targets
- `filterTbAlpha`, `filterTeAlpha`, `filterDTAlpha`, `filterRorAlpha`: low-pass filter weights

PID/Smith fields:

- `pidKp`, `pidKi`, `pidKd`
- `pidDerivativeFilterAlpha`
- `pidPredictorEnabled`
- `pidProcessDelaySec`: measured command-to-temperature lag used explicitly by the Smith predictor
- `pidSmithModelGain`, `pidSmithModelTauSec`: exposed model terms for future refinement

ADRC fields:

- `adrcB0`, `adrcW0`, `adrcWc`
- `adrcScheduleEnabled`: uses a fan/heater operating-point table rather than one fixed tuning
- `adrcFanControlEnabled`: allows fan to act as slower coordinated secondary action

## Empty-Roaster Identification

Beans are not required for initial tuning. The firmware supports a bounded no-bean run:

```json
{
  "command":"startNoBeanIdentification",
  "fan":50,
  "heaterLow":0,
  "heaterHigh":60,
  "fanHigh":70,
  "baselineSec":15,
  "stepSec":35
}
```

The run phases are `baseline`, `heater_step`, `fan_step`, and `complete`. Telemetry includes:

- `noBeanLagSec`
- `noBeanTauTbSec`, `noBeanTauTeSec`
- `noBeanGainTbPerHeater`, `noBeanGainTePerHeater`
- `noBeanSuggestedAdrcB0`, `noBeanSuggestedAdrcW0`, `noBeanSuggestedAdrcWc`

The firmware also emits `control_log` lines with timestamp, commands, BT, ET, dT, RoR, setpoints, raw outputs, alarms, lag, and model states.

For offline analysis:

```sh
python3 scripts/no_bean_identification.py path/to/no-bean.log --pretty
```

The script accepts firmware `control_log` text or CSV with columns such as `ms,uh,uf,Tb,Te,dT,RoR`.

## Design Note

No-bean dynamics are only a first layer. Bean-loaded roasting changes gain, lag, and coupling, especially when fan changes lofting and convection. Runtime scheduling by fan, heater, roast phase proxy, and measured `dT` is preserved so empty-roaster parameters can be conservative seeds rather than a single assumed-perfect model.
