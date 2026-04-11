import "./style.css";
import van from "vanjs-core";
import { roastApp } from "./roast";
import { ProfileControl } from "./profiling.ts";
import { connectionStatus, lastMessage, lastUpdate } from "./websocket";
import { getBasicAuthHeaderValue } from "./auth";

declare const __APP_VERSION__: string;
declare const __BUILD_TIMESTAMP__: string;

interface DeviceInfo {
  firmwareVersion: string;
  networkMode: string;
  ssid: string;
  ip: string;
  hostname: string;
  csrfToken?: string;
}

const { aside, article, button, div, h1, h2, input, main, nav, p, section, small, span } = van.tags;

const activePanel = van.state<"home" | "roasting" | "update">("home");

// Wifi
const ssidField = van.state("");
const passField = van.state("");

// Versioning and network details
const deviceInfo = van.state<DeviceInfo | null>(null);
const deviceInfoError = van.state<string | null>(null);
const csrfToken = van.state("");

const appVersion = __APP_VERSION__;
const buildTimestamp = new Date(__BUILD_TIMESTAMP__).toLocaleString();
const roastingView = roastApp();

const refreshDeviceInfo = async () => {
  try {
    deviceInfoError.val = null;
    const response = await fetch(`http://${location.host}/api/info`);
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    deviceInfo.val = (await response.json()) as DeviceInfo;
    csrfToken.val = deviceInfo.val.csrfToken || "";
  } catch (error: unknown) {
    deviceInfo.val = null;
    if (error instanceof Error) {
      deviceInfoError.val = error.message;
    } else {
      deviceInfoError.val = "Unknown error";
    }
  }
};

void refreshDeviceInfo();

const updateWifiSettings = async () => {
  const ssid = ssidField.val;
  const pass = passField.val;

  try {
    const response = await fetch(`http://${location.host}/api/wifi`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: getBasicAuthHeaderValue(),
        "X-Yaeger-CSRF": csrfToken.val,
      },
      body: JSON.stringify({ ssid, pass }),
    });
    if (response.ok) {
      alert(
        "Wifi settings updated!\nPlease restart for the new settings to take effect",
      );
      await refreshDeviceInfo();
    } else {
      alert(`Something happened: ${response.status}`);
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      alert(`Error: ${error.message}`);
    } else {
      alert("An unknown error occurred");
    }
  }
};

const ConnectionStatus = () =>
  div(
    { class: "status-pill" },
    span("Connection:"),
    span(
      {
        class: () =>
          connectionStatus.val === "Connected"
            ? "status-ok"
            : connectionStatus.val === "Error"
              ? "status-bad"
              : "status-warn",
      },
      () => connectionStatus.val,
    ),
  );

const SensorData = () =>
  article(
    { class: "surface" },
    h2("Live Sensors"),
    p("ET: ", () => lastMessage.val?.ET ?? "N/A", "°C"),
    p("BT: ", () => lastMessage.val?.BT ?? "N/A", "°C"),
    p("Last update: ", () => lastUpdate.val?.toString() ?? "N/A"),
  );

const VersionAndNetworkInfo = () =>
  article(
    { class: "surface" },
    h2("Version & Network Info"),
    p("Web UI version: ", appVersion),
    p("Web UI build: ", buildTimestamp),
    p("Viewed via: ", location.origin),
    () =>
      deviceInfo.val
        ? div(
            p("Firmware version: ", deviceInfo.val.firmwareVersion),
            p("Network mode: ", deviceInfo.val.networkMode),
            p("SSID: ", deviceInfo.val.ssid || "N/A"),
            p("IP address: ", deviceInfo.val.ip || "N/A"),
            p("Hostname: ", deviceInfo.val.hostname || "N/A"),
          )
        : p("Device info unavailable"),
    () =>
      deviceInfoError.val
        ? p(
            { class: "status-bad" },
            "Could not load network info: ",
            deviceInfoError.val,
          )
        : null,
    button({ onclick: refreshDeviceInfo }, "Refresh Info"),
  );

const wifiSettings = () =>
  article(
    { class: "surface" },
    h2("Wifi Settings"),
    p("Wifi SSID"),
    input({
      type: "text",
      oninput: (e: Event) => {
        ssidField.val = (e.target as HTMLInputElement).value;
      },
    }),
    p("Wifi Password"),
    input({
      type: "password",
      oninput: (e: Event) => {
        passField.val = (e.target as HTMLInputElement).value;
      },
    }),
    button({ onclick: updateWifiSettings }, "Update Wifi"),
  );

const HomePanel = () =>
  section(
    { class: "panel" },
    div({ class: "panel-header" }, h1("Home"), p("Overview and quick health checks.")),
    div({ class: "panel-grid" }, SensorData(), VersionAndNetworkInfo()),
  );

const RoastingPanel = () =>
  section(
    { class: "panel" },
    div(
      { class: "panel-header" },
      h1("Roasting"),
      p("Live roast controls, charting and event markers."),
    ),
    article({ class: "surface roast-surface" }, roastingView),
  );

const UpdatePanel = () =>
  section(
    { class: "panel" },
    div({ class: "panel-header" }, h1("Update"), p("Device and profile management.")),
    div(
      { class: "panel-grid" },
      wifiSettings(),
      article({ class: "surface" }, h2("Profile"), ProfileControl),
    ),
  );

const App = () =>
  div(
    { class: "app-shell" },
    aside(
      { class: "side-nav" },
      div({ class: "brand" }, small("Yaeger"), h1("Roast Console")),
      ConnectionStatus,
      nav(
        { class: "nav-list" },
        button(
          {
            class: () => (activePanel.val === "home" ? "active" : ""),
            onclick: () => (activePanel.val = "home"),
          },
          span("Home"),
          small("Overview"),
        ),
        button(
          {
            class: () => (activePanel.val === "roasting" ? "active" : ""),
            onclick: () => (activePanel.val = "roasting"),
          },
          span("Roasting"),
          small("Controls & graph"),
        ),
        button(
          {
            class: () => (activePanel.val === "update" ? "active" : ""),
            onclick: () => (activePanel.val = "update"),
          },
          span("Update"),
          small("Settings"),
        ),
      ),
    ),
    main(
      { class: "main-content" },
      () => {
        if (activePanel.val === "home") return HomePanel();
        if (activePanel.val === "roasting") return RoastingPanel();
        return UpdatePanel();
      },
    ),
  );

van.add(document.getElementById("app")!, App());
