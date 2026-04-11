import { useEffect, useMemo, useRef, useState } from "react";
import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Legend,
  Tooltip,
  type ChartConfiguration,
} from "chart.js";
import "./style.css";

type YaegerMessage = {
  ET: number;
  BT: number;
  FanVal: number;
  BurnerVal: number;
};

type DataPoint = {
  seconds: number;
  et: number;
  bt: number;
  etRor: number;
  btRor: number;
};

type Tab = "Home" | "Editor" | "Settings";

Chart.register(CategoryScale, LinearScale, PointElement, LineElement, Legend, Tooltip);

const WS_PATH = "/ws";
const MAX_POINTS = 240;

function clampPoints(points: DataPoint[]) {
  return points.length > MAX_POINTS ? points.slice(points.length - MAX_POINTS) : points;
}

function calcRor(current: number, prev: number, dtSeconds: number): number {
  if (dtSeconds <= 0) return 0;
  return ((current - prev) / dtSeconds) * 60;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("Home");
  const [connection, setConnection] = useState("Disconnected");
  const [lastMessage, setLastMessage] = useState<YaegerMessage | null>(null);
  const [points, setPoints] = useState<DataPoint[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const lastSampleRef = useRef<{ timestamp: number; et: number; bt: number } | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}${WS_PATH}`);
    let pollTimer: number | undefined;

    ws.onopen = () => {
      setConnection("Connected");
      ws.send(JSON.stringify({ id: 1, command: "getData" }));
      pollTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ id: 1, command: "getData" }));
        }
      }, 1000);
    };

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        const msg: YaegerMessage | undefined = parsed.data;
        if (!msg) return;

        const now = Date.now();
        setLastMessage(msg);
        if (startTimeRef.current == null) {
          startTimeRef.current = now;
        }

        setPoints((prev) => {
          const previous = lastSampleRef.current;
          const elapsedSeconds = startTimeRef.current
            ? (now - startTimeRef.current) / 1000
            : 0;
          const dtSeconds = previous ? (now - previous.timestamp) / 1000 : 0;
          const etRor = previous ? calcRor(msg.ET, previous.et, dtSeconds) : 0;
          const btRor = previous ? calcRor(msg.BT, previous.bt, dtSeconds) : 0;

          lastSampleRef.current = { timestamp: now, et: msg.ET, bt: msg.BT };

          return clampPoints([
            ...prev,
            {
              seconds: elapsedSeconds,
              et: msg.ET,
              bt: msg.BT,
              etRor,
              btRor,
            },
          ]);
        });
      } catch (error) {
        console.error("failed to parse websocket payload", error);
      }
    };

    ws.onerror = () => setConnection("Error");
    ws.onclose = () => setConnection("Disconnected");

    return () => {
      if (pollTimer) window.clearInterval(pollTimer);
      ws.close();
    };
  }, []);

  useEffect(() => {
    if (!canvasRef.current) return;

    const config: ChartConfiguration<"line"> = {
      type: "line",
      data: {
        labels: points.map((point) => `${Math.round(point.seconds)}s`),
        datasets: [
          {
            label: "ET",
            data: points.map((point) => point.et),
            borderColor: "#ef4444",
            pointRadius: 0,
            tension: 0.25,
          },
          {
            label: "BT",
            data: points.map((point) => point.bt),
            borderColor: "#2563eb",
            pointRadius: 0,
            tension: 0.25,
          },
          {
            label: "ET RoR (°C/min)",
            data: points.map((point) => point.etRor),
            borderColor: "#7e22ce",
            pointRadius: 0,
            tension: 0.2,
            yAxisID: "y1",
          },
          {
            label: "BT RoR (°C/min)",
            data: points.map((point) => point.btRor),
            borderColor: "#16a34a",
            pointRadius: 0,
            tension: 0.2,
            yAxisID: "y1",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { title: { display: true, text: "Temperature (°C)" } },
          y1: {
            position: "right",
            title: { display: true, text: "RoR (°C/min)" },
            grid: { drawOnChartArea: false },
          },
        },
      },
    };

    if (!chartRef.current) {
      chartRef.current = new Chart(canvasRef.current, config);
      return;
    }

    chartRef.current.data = config.data;
    chartRef.current.update();
  }, [points]);

  const latest = points[points.length - 1];
  const elapsed = useMemo(() => {
    if (!latest) return "00:00";
    const mins = Math.floor(latest.seconds / 60)
      .toString()
      .padStart(2, "0");
    const secs = Math.floor(latest.seconds % 60)
      .toString()
      .padStart(2, "0");
    return `${mins}:${secs}`;
  }, [latest]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>ReYaeger Frontend</h1>
        <nav>
          {(["Home", "Editor", "Settings"] as Tab[]).map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? "tab active" : "tab"}
              onClick={() => setActiveTab(tab)}
            >
              {tab}
            </button>
          ))}
        </nav>
        <p className={`status ${connection.toLowerCase()}`}>● {connection}</p>
      </aside>

      <main className="content">
        <section className="chart-card">
          <header>
            <h2>{activeTab}</h2>
            <p>Live roast metrics with ET/BT and RoR trends.</p>
          </header>
          <div className="chart-wrap">
            <canvas ref={canvasRef} />
          </div>
        </section>

        <section className="metrics-grid">
          <article className="metric">
            <h3>ET</h3>
            <p>{lastMessage?.ET?.toFixed(1) ?? "--"} °C</p>
          </article>
          <article className="metric">
            <h3>BT</h3>
            <p>{lastMessage?.BT?.toFixed(1) ?? "--"} °C</p>
          </article>
          <article className="metric">
            <h3>ET RoR</h3>
            <p>{latest?.etRor?.toFixed(1) ?? "--"} °C/min</p>
          </article>
          <article className="metric">
            <h3>BT RoR</h3>
            <p>{latest?.btRor?.toFixed(1) ?? "--"} °C/min</p>
          </article>
          <article className="metric">
            <h3>Fan Power</h3>
            <p>{lastMessage?.FanVal?.toFixed(1) ?? "--"} %</p>
          </article>
          <article className="metric">
            <h3>Heater Power</h3>
            <p>{lastMessage?.BurnerVal?.toFixed(1) ?? "--"} %</p>
          </article>
          <article className="metric">
            <h3>Timer</h3>
            <p>{elapsed}</p>
          </article>
        </section>
      </main>
    </div>
  );
}
