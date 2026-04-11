import { useEffect, useMemo, useRef, useState } from "react";
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

const WS_PATH = "/ws";
const MAX_POINTS = 240;

function clampPoints(points: DataPoint[]) {
  return points.length > MAX_POINTS ? points.slice(points.length - MAX_POINTS) : points;
}

function calcRor(current: number, prev: number, dtSeconds: number): number {
  if (dtSeconds <= 0) return 0;
  return ((current - prev) / dtSeconds) * 60;
}

function drawChart(canvas: HTMLCanvasElement, points: DataPoint[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width === 0 || height === 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  const pad = 40;
  const chartW = width - pad * 2;
  const chartH = height - pad * 2;

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const y = pad + (chartH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(width - pad, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "#94a3b8";
  ctx.beginPath();
  ctx.moveTo(pad, pad);
  ctx.lineTo(pad, height - pad);
  ctx.lineTo(width - pad, height - pad);
  ctx.stroke();

  if (points.length < 2) return;

  const maxX = points[points.length - 1].seconds || 1;
  const tempValues = points.flatMap((p) => [p.et, p.bt]);
  const rorValues = points.flatMap((p) => [p.etRor, p.btRor]);
  const minTemp = Math.min(...tempValues) - 10;
  const maxTemp = Math.max(...tempValues) + 10;
  const minRor = Math.min(...rorValues, -5);
  const maxRor = Math.max(...rorValues, 5);

  const x = (s: number) => pad + (s / maxX) * chartW;
  const yTemp = (v: number) => pad + ((maxTemp - v) / (maxTemp - minTemp || 1)) * chartH;
  const yRor = (v: number) => pad + ((maxRor - v) / (maxRor - minRor || 1)) * chartH;

  const drawLine = (color: string, getX: (p: DataPoint) => number, getY: (p: DataPoint) => number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, i) => {
      const px = getX(p);
      const py = getY(p);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  };

  drawLine("#ef4444", (p) => x(p.seconds), (p) => yTemp(p.et));
  drawLine("#2563eb", (p) => x(p.seconds), (p) => yTemp(p.bt));
  drawLine("#7e22ce", (p) => x(p.seconds), (p) => yRor(p.etRor));
  drawLine("#16a34a", (p) => x(p.seconds), (p) => yRor(p.btRor));
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("Home");
  const [connection, setConnection] = useState("Disconnected");
  const [lastMessage, setLastMessage] = useState<YaegerMessage | null>(null);
  const [points, setPoints] = useState<DataPoint[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastSampleRef = useRef<{ timestamp: number; et: number; bt: number } | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawChart(canvas, points);
    const handleResize = () => drawChart(canvas, points);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [points]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let pollTimer: number | null = null;

    try {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${protocol}://${window.location.host}${WS_PATH}`);
    } catch (error) {
      console.error("websocket init failed", error);
      setConnection("Error");
      return;
    }

    ws.onopen = () => {
      setConnection("Connected");
      ws?.send(JSON.stringify({ id: 1, command: "getData" }));
      pollTimer = window.setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
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
        if (startTimeRef.current == null) startTimeRef.current = now;

        setPoints((prev) => {
          const previous = lastSampleRef.current;
          const elapsedSeconds = startTimeRef.current ? (now - startTimeRef.current) / 1000 : 0;
          const dtSeconds = previous ? (now - previous.timestamp) / 1000 : 0;
          const etRor = previous ? calcRor(msg.ET, previous.et, dtSeconds) : 0;
          const btRor = previous ? calcRor(msg.BT, previous.bt, dtSeconds) : 0;

          lastSampleRef.current = { timestamp: now, et: msg.ET, bt: msg.BT };
          return clampPoints([...prev, { seconds: elapsedSeconds, et: msg.ET, bt: msg.BT, etRor, btRor }]);
        });
      } catch (error) {
        console.error("failed to parse websocket payload", error);
      }
    };

    ws.onerror = () => setConnection("Error");
    ws.onclose = () => setConnection("Disconnected");

    return () => {
      if (pollTimer != null) window.clearInterval(pollTimer);
      ws?.close();
    };
  }, []);

  const latest = points[points.length - 1];
  const elapsed = useMemo(() => {
    if (!latest) return "00:00";
    const mins = Math.floor(latest.seconds / 60).toString().padStart(2, "0");
    const secs = Math.floor(latest.seconds % 60).toString().padStart(2, "0");
    return `${mins}:${secs}`;
  }, [latest]);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <h1>ReYaeger Frontend</h1>
        <nav>
          {(["Home", "Editor", "Settings"] as Tab[]).map((tab) => (
            <button key={tab} className={activeTab === tab ? "tab active" : "tab"} onClick={() => setActiveTab(tab)}>
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
          <article className="metric"><h3>ET</h3><p>{lastMessage?.ET?.toFixed(1) ?? "--"} °C</p></article>
          <article className="metric"><h3>BT</h3><p>{lastMessage?.BT?.toFixed(1) ?? "--"} °C</p></article>
          <article className="metric"><h3>ET RoR</h3><p>{latest?.etRor?.toFixed(1) ?? "--"} °C/min</p></article>
          <article className="metric"><h3>BT RoR</h3><p>{latest?.btRor?.toFixed(1) ?? "--"} °C/min</p></article>
          <article className="metric"><h3>Fan Power</h3><p>{lastMessage?.FanVal?.toFixed(1) ?? "--"} %</p></article>
          <article className="metric"><h3>Heater Power</h3><p>{lastMessage?.BurnerVal?.toFixed(1) ?? "--"} %</p></article>
          <article className="metric"><h3>Timer</h3><p>{elapsed}</p></article>
        </section>
      </main>
    </div>
  );
}
