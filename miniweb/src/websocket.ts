import type { YaegerMessage } from "./model";

export class Signal<T> {
  private _val: T;
  private listeners = new Set<(value: T) => void>();

  constructor(initial: T) {
    this._val = initial;
  }

  get val(): T {
    return this._val;
  }

  set val(next: T) {
    this._val = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const connectionStatus = new Signal("Disconnected");
export const lastMessage = new Signal<YaegerMessage | null>(null);
export const lastUpdate = new Signal<Date | null>(null);

const WS_PATH = "/ws";
const DATA_REQUEST_INTERVAL_MS = 1000;
const RECONNECT_DELAY_MS = 2000;

let socket: WebSocket | null = null;
let requestTimerId: number | null = null;
let reconnectTimerId: number | null = null;

function stopPolling() {
  if (requestTimerId != null) {
    window.clearInterval(requestTimerId);
    requestTimerId = null;
  }
}

function scheduleReconnect() {
  if (reconnectTimerId != null) return;
  reconnectTimerId = window.setTimeout(() => {
    reconnectTimerId = null;
    connectWebSocket();
  }, RECONNECT_DELAY_MS);
}

function sendGetData() {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify({ id: 1, command: "getData" }));
}

function handleMessage(event: MessageEvent) {
  try {
    const parsed = JSON.parse(event.data);
    const message: YaegerMessage | undefined = parsed.data;
    if (message) {
      lastMessage.val = message;
      lastUpdate.val = new Date();
    }
  } catch (error) {
    console.error("Error parsing WebSocket message:", error);
  }
}

function connectWebSocket() {
  stopPolling();

  const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${wsProtocol}://${location.host}${WS_PATH}`);

  socket.onopen = () => {
    connectionStatus.val = "Connected";
    sendGetData();
    requestTimerId = window.setInterval(sendGetData, DATA_REQUEST_INTERVAL_MS);
  };

  socket.onmessage = handleMessage;

  socket.onclose = () => {
    connectionStatus.val = "Disconnected";
    stopPolling();
    scheduleReconnect();
  };

  socket.onerror = (error) => {
    console.error("WebSocket error:", error);
    connectionStatus.val = "Error";
    stopPolling();
    socket?.close();
  };
}

connectWebSocket();

export function sendCommand(command: Record<string, unknown>) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(command));
  }
}
