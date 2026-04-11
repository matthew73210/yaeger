import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

function mount() {
  const rootElement = document.getElementById("app");
  if (!rootElement) {
    console.error("Could not find #app container");
    return;
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
  mount();
}
