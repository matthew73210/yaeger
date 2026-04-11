import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import van from "vanjs-core";
import { getBasicAuthHeaderValue } from "./auth";
import { roastApp } from "./roast";
import { autotuneApp } from "./autotune";
import { logsApp } from "./logs";
import { connectionStatus, lastMessage, lastUpdate } from "./websocket";

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

function useVanState<T>(state: { val: T }): T {
  const [value, setValue] = useState(state.val);

  useEffect(() => {
    const derived = van.derive(() => {
      setValue(state.val);
    });

    return () => {
      derived.val = null as unknown as T;
    };
  }, [state]);

  return value;
}

function LegacyMount({ factory }: { factory: () => HTMLElement }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    if (!nodeRef.current) {
      nodeRef.current = factory();
    }

    host.replaceChildren(nodeRef.current);

    return () => {
      host.replaceChildren();
    };
  }, [factory]);

  return <div ref={hostRef} />;
}

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const status = useVanState(connectionStatus);
  const message = useVanState(lastMessage);
  const updatedAt = useVanState(lastUpdate);
  const [ssid, setSsid] = useState("");
  const [pass, setPass] = useState("");
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const [deviceInfoError, setDeviceInfoError] = useState<string | null>(null);

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
        {activeTab === "roast" && <LegacyMount factory={roastApp} />}
        {activeTab === "autotune" && <LegacyMount factory={autotuneApp} />}
        {activeTab === "logs" && <LegacyMount factory={logsApp} />}
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

function HomeTab({ status, message, updatedAt }: { status: string; message: any; updatedAt: Date | null }) {
  return (
    <>
      <h1>Yaeger Roaster Control</h1>
      <p class="muted">Preact + Vite UI with legacy roast/autotune graphs restored.</p>
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
