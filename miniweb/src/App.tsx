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

function useRoastChart(message: YaegerMessage | null) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<"line"> | null>(null);

  useEffect(() => {
    if (!canvasRef.current || chartRef.current) return;

    const data: ChartData<"line"> = {
      labels: [],
      datasets: [
        { label: "ET", data: [], borderColor: "#f97316", tension: 0.2 },
        { label: "BT", data: [], borderColor: "#3b82f6", tension: 0.2 },
        { label: "simBT", data: [], borderColor: "#8b5cf6", tension: 0.2 },
      ],
    };

    chartRef.current = new Chart<"line">(canvasRef.current, {
      type: "line",
      data,
      options: {
        responsive: true,
        animation: false,
        scales: {
          y: { title: { display: true, text: "°C" } },
        },
      },
    });

    return () => chartRef.current?.destroy();
  }, []);

  useEffect(() => {
    if (!message || !chartRef.current) return;
    const chart = chartRef.current;
    const label = new Date().toLocaleTimeString();

    chart.data.labels?.push(label);
    chart.data.datasets[0].data.push(message.ET);
    chart.data.datasets[1].data.push(message.BT);
    chart.data.datasets[2].data.push(message.simBT ?? null);

    const maxPoints = 300;
    if ((chart.data.labels?.length ?? 0) > maxPoints) {
      chart.data.labels = chart.data.labels?.slice(-maxPoints);
      for (const ds of chart.data.datasets) {
        ds.data = ds.data.slice(-maxPoints);
      }
    }
    chart.update();
  }, [message]);

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
        {activeTab === "roast" && <RoastTab message={message} />}
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
  return <div class="section"><h2>Status</h2><p>Connection: {status}</p><p>ET: {message?.ET ?? "N/A"}°C</p><p>BT: {message?.BT ?? "N/A"}°C</p><p>Last update: {updatedAt?.toLocaleTimeString() ?? "N/A"}</p></div>;
}

function RoastTab({ message }: { message: YaegerMessage | null }) {
  const [fan, setFan] = useState(50);
  const [heater, setHeater] = useState(50);
  const chartRef = useRoastChart(message);

  useEffect(() => {
    if (!message) return;
    setFan(message.FanVal);
    setHeater(message.BurnerVal);
  }, [message]);

  return (
    <div class="section">
      <h2>Roast Control + Live Graph</h2>
      <canvas ref={chartRef} height={180} />
      <div class="slider-wrapper"><label>Fan {fan}%</label><input type="range" min={0} max={100} value={fan} onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); setFan(v); sendCommand({ id: 1, FanVal: v }); }} /></div>
      <div class="slider-wrapper"><label>Heater {heater}%</label><input type="range" min={0} max={100} value={heater} onInput={(e) => { const v = Number((e.target as HTMLInputElement).value); setHeater(v); sendCommand({ id: 1, BurnerVal: v }); }} /></div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button onClick={() => sendCommand({ id: 1, command: "startRoast" })}>Start Roast</button>
        <button onClick={() => sendCommand({ id: 1, command: "endRoast" })}>End Roast</button>
        <button onClick={() => sendCommand({ id: 1, BurnerVal: 0, FanVal: 100 })}>Emergency Cool</button>
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

  const submit = (pidAutotune: boolean) => sendCommand({ id: 1, pidAutotune, pidTarget: target, pidTuneMethod: method, setpoint, FanVal: fanSpeed, pidAutotuneMin: minHeaterPwm, pidAutotuneMax: maxHeaterPwm });

  return <div class="section"><h2>PID Autotune</h2><div class="form-grid"><label>Target</label><select value={target} onInput={(e) => setTarget((e.target as HTMLSelectElement).value as "BT" | "ET" | "simBT")}><option value="BT">BT</option><option value="ET">ET</option><option value="simBT">simBT</option></select><label>Method</label><select value={method} onInput={(e) => setMethod((e.target as HTMLSelectElement).value as "ziegler-nichols" | "tyreus-luyben" | "pessen-integral" | "no-overshoot")}><option value="ziegler-nichols">Ziegler-Nichols</option><option value="tyreus-luyben">Tyreus-Luyben</option><option value="pessen-integral">Pessen</option><option value="no-overshoot">No Overshoot</option></select><label>Setpoint</label><input type="number" value={setpoint} onInput={(e) => setSetpoint(Number((e.target as HTMLInputElement).value))} /><label>Fan</label><input type="number" value={fanSpeed} onInput={(e) => setFanSpeed(Number((e.target as HTMLInputElement).value))} /><label>Min Heater</label><input type="number" value={minHeaterPwm} onInput={(e) => setMinHeaterPwm(Number((e.target as HTMLInputElement).value))} /><label>Max Heater</label><input type="number" value={maxHeaterPwm} onInput={(e) => setMaxHeaterPwm(Number((e.target as HTMLInputElement).value))} /></div><p>Active: {message?.pidAutotune ? "Yes" : "No"}</p><p>Crossings: {message?.pidAutotuneCrossings ?? 0}/{message?.pidAutotuneTargetCrossings ?? 0}</p><button onClick={() => submit(true)}>Start Autotune</button> <button onClick={() => submit(false)}>Stop Autotune</button></div>;
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
  return <div class="section"><h2>Settings</h2><p>Web UI version: {props.appVersion}</p><p>Web UI build: {props.buildTimestamp}</p><p>Firmware: {props.deviceInfo?.firmwareVersion ?? "N/A"}</p><p>IP: {props.deviceInfo?.ip ?? "N/A"}</p>{props.deviceInfoError && <p style={{ color: "#b91c1c" }}>{props.deviceInfoError}</p>}<button onClick={() => void props.refreshDeviceInfo()}>Refresh Info</button><div class="form-grid"><label>Wi‑Fi SSID</label><input type="text" value={props.ssid} onInput={(e) => props.setSsid((e.target as HTMLInputElement).value)} /><label>Wi‑Fi Password</label><input type="password" value={props.pass} onInput={(e) => props.setPass((e.target as HTMLInputElement).value)} /></div><button onClick={() => void props.updateWifiSettings()}>Update Wi-Fi</button></div>;
}
