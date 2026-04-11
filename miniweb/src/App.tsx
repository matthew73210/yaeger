import { useEffect, useMemo, useState } from "preact/hooks";
import { getBasicAuthHeaderValue } from "./auth";
import { connectionStatus, lastMessage, lastUpdate, Signal, socket } from "./websocket";
import type { YaegerMessage } from "./model";

declare const __APP_VERSION__: string;
declare const __BUILD_TIMESTAMP__: string;

type AppTab = "home" | "roast" | "autotune" | "logs" | "settings";

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

function sendCommand(command: Record<string, unknown>) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(command));
  }
}

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const status = useSignalValue(connectionStatus);
  const message = useSignalValue(lastMessage);
  const updatedAt = useSignalValue(lastUpdate);
  const [fan, setFan] = useState(50);
  const [heater, setHeater] = useState(50);
  const [ssid, setSsid] = useState("");
  const [pass, setPass] = useState("");
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [deviceInfoError, setDeviceInfoError] = useState<string | null>(null);

  useEffect(() => {
    if (!message) {
      return;
    }

    setFan(message.FanVal);
    setHeater(message.BurnerVal);
  }, [message]);

  const buildTimestamp = useMemo(
    () => new Date(__BUILD_TIMESTAMP__).toLocaleString(),
    [],
  );

  async function refreshDeviceInfo() {
    try {
      setDeviceInfoError(null);
      const response = await fetch(`http://${location.host}/api/info`);
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
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
    try {
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
    } catch (error) {
      alert(error instanceof Error ? error.message : "Unknown error");
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
        {activeTab === "roast" && <RoastTab fan={fan} heater={heater} setFan={setFan} setHeater={setHeater} />}
        {activeTab === "autotune" && <AutotuneTab message={message} />}
        {activeTab === "logs" && <LogsTab />}
        {activeTab === "settings" && (
          <SettingsTab
            appVersion={__APP_VERSION__}
            buildTimestamp={buildTimestamp}
            deviceInfo={deviceInfo}
            deviceInfoError={deviceInfoError}
            refreshDeviceInfo={refreshDeviceInfo}
            ssid={ssid}
            pass={pass}
            setSsid={setSsid}
            setPass={setPass}
            updateWifiSettings={updateWifiSettings}
          />
        )}
      </div>
    </div>
  );
}

function HomeTab({ status, message, updatedAt }: { status: string; message: YaegerMessage | null; updatedAt: Date | null }) {
  return (
    <>
      <h1>Yaeger Roaster Control</h1>
      <p class="muted">Preact + Vite UI.</p>
      <div class="connection-status">
        Connection Status:{" "}
        <span style={{ color: status === "Connected" ? "#059669" : status === "Error" ? "#dc2626" : "#d97706" }}>{status}</span>
      </div>
      <div class="section">
        <h2>Current Readings</h2>
        <p>ET: {message?.ET ?? "N/A"}°C</p>
        <p>BT: {message?.BT ?? "N/A"}°C</p>
        <p>Sim BT: {message?.simBT ?? "N/A"}°C</p>
        <p>Sensor age: {message?.sampleAgeMs ?? "N/A"} ms</p>
        <p>Sensor status: {message?.sensorOk ? "OK" : "BUSY/STALE"}</p>
        <p>Last update: {updatedAt?.toLocaleTimeString() ?? "N/A"}</p>
      </div>
    </>
  );
}

function RoastTab({ fan, heater, setFan, setHeater }: { fan: number; heater: number; setFan: (n: number) => void; setHeater: (n: number) => void }) {
  return (
    <div class="section">
      <h2>Manual Roast Controls</h2>
      <div class="slider-wrapper">
        <label for="fan">Fan: {fan}%</label>
        <input
          id="fan"
          type="range"
          min={0}
          max={100}
          value={fan}
          onInput={(event) => {
            const value = Number((event.target as HTMLInputElement).value);
            setFan(value);
            sendCommand({ id: 1, FanVal: value });
          }}
        />
      </div>
      <div class="slider-wrapper">
        <label for="heater">Heater: {heater}%</label>
        <input
          id="heater"
          type="range"
          min={0}
          max={100}
          value={heater}
          onInput={(event) => {
            const value = Number((event.target as HTMLInputElement).value);
            setHeater(value);
            sendCommand({ id: 1, BurnerVal: value });
          }}
        />
      </div>
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

  function sendAutotuneCommand(pidAutotune: boolean) {
    sendCommand({
      id: 1,
      pidAutotune,
      pidTarget: target,
      pidTuneMethod: method,
      setpoint,
      FanVal: fanSpeed,
      pidAutotuneMin: minHeaterPwm,
      pidAutotuneMax: maxHeaterPwm,
    });
  }

  return (
    <div class="section">
      <h2>PID Autotune</h2>
      <div class="form-grid">
        <label for="pid-target">Target</label>
        <select id="pid-target" value={target} onInput={(e) => setTarget((e.target as HTMLSelectElement).value as "BT" | "ET" | "simBT")}>
          <option value="BT">BT</option>
          <option value="ET">ET</option>
          <option value="simBT">simBT</option>
        </select>

        <label for="pid-method">Method</label>
        <select id="pid-method" value={method} onInput={(e) => setMethod((e.target as HTMLSelectElement).value as "ziegler-nichols" | "tyreus-luyben" | "pessen-integral" | "no-overshoot")}>
          <option value="ziegler-nichols">Ziegler-Nichols</option>
          <option value="tyreus-luyben">Tyreus-Luyben</option>
          <option value="pessen-integral">Pessen Integral</option>
          <option value="no-overshoot">No Overshoot</option>
        </select>

        <label for="pid-setpoint">Setpoint</label>
        <input id="pid-setpoint" type="number" value={setpoint} onInput={(e) => setSetpoint(Number((e.target as HTMLInputElement).value))} />

        <label for="pid-fan">Fan</label>
        <input id="pid-fan" type="number" value={fanSpeed} onInput={(e) => setFanSpeed(Number((e.target as HTMLInputElement).value))} />

        <label for="pid-min">Min Heater</label>
        <input id="pid-min" type="number" value={minHeaterPwm} onInput={(e) => setMinHeaterPwm(Number((e.target as HTMLInputElement).value))} />

        <label for="pid-max">Max Heater</label>
        <input id="pid-max" type="number" value={maxHeaterPwm} onInput={(e) => setMaxHeaterPwm(Number((e.target as HTMLInputElement).value))} />
      </div>

      <p style={{ marginTop: "1rem" }}>
        Active: <strong>{message?.pidAutotune ? "Yes" : "No"}</strong>
      </p>
      <p>Crossings: {message?.pidAutotuneCrossings ?? 0} / {message?.pidAutotuneTargetCrossings ?? 0}</p>
      <p>Ku: {message?.pidAutotuneKu ?? "N/A"} | Pu: {message?.pidAutotunePu ?? "N/A"}</p>
      <p>Elapsed: {message?.pidAutotuneElapsedSec ?? 0}s | ETA: {message?.pidAutotuneEtaSec ?? 0}s</p>

      <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
        <button onClick={() => sendAutotuneCommand(true)}>Start Autotune</button>
        <button onClick={() => sendAutotuneCommand(false)}>Stop Autotune</button>
      </div>
    </div>
  );
}

function LogsTab() {
  const [logs, setLogs] = useState("");
  const [error, setError] = useState("");

  async function fetchLogs() {
    try {
      setError("");
      const response = await fetch(`http://${location.host}/api/logs`, {
        headers: { Authorization: getBasicAuthHeaderValue() },
      });
      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }
      setLogs(await response.text());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  return (
    <div class="section">
      <h2>Logs</h2>
      <button onClick={() => void fetchLogs()}>Refresh Logs</button>
      {error && <p style={{ color: "#b91c1c" }}>{error}</p>}
      <textarea readOnly value={logs} rows={18} style={{ width: "100%", marginTop: "1rem" }} />
    </div>
  );
}

function SettingsTab(props: {
  appVersion: string;
  buildTimestamp: string;
  deviceInfo: DeviceInfo | null;
  deviceInfoError: string | null;
  refreshDeviceInfo: () => Promise<void>;
  ssid: string;
  pass: string;
  setSsid: (value: string) => void;
  setPass: (value: string) => void;
  updateWifiSettings: () => Promise<void>;
}) {
  return (
    <>
      <div class="section">
        <h2>Version & Network Info</h2>
        <p>Web UI version: {props.appVersion}</p>
        <p>Web UI build: {props.buildTimestamp}</p>
        <p>Viewed via: {location.origin}</p>
        <p>Firmware version: {props.deviceInfo?.firmwareVersion ?? "N/A"}</p>
        <p>Network mode: {props.deviceInfo?.networkMode ?? "N/A"}</p>
        <p>SSID: {props.deviceInfo?.ssid ?? "N/A"}</p>
        <p>IP: {props.deviceInfo?.ip ?? "N/A"}</p>
        <p>Hostname: {props.deviceInfo?.hostname ?? "N/A"}</p>
        {props.deviceInfoError && <p style={{ color: "#b91c1c" }}>Could not load network info: {props.deviceInfoError}</p>}
        <button onClick={() => void props.refreshDeviceInfo()}>Refresh Info</button>
      </div>
      <div class="section">
        <h2>Wi-Fi Settings</h2>
        <div class="form-grid">
          <label for="wifi-ssid">Wi‑Fi SSID</label>
          <input id="wifi-ssid" type="text" autoComplete="off" value={props.ssid} onInput={(e) => props.setSsid((e.target as HTMLInputElement).value)} />
          <label for="wifi-pass">Wi‑Fi Password</label>
          <input id="wifi-pass" type="password" autoComplete="new-password" value={props.pass} onInput={(e) => props.setPass((e.target as HTMLInputElement).value)} />
        </div>
        <p />
        <button onClick={() => void props.updateWifiSettings()}>Update Wi-Fi</button>
      </div>
    </>
  );
}
