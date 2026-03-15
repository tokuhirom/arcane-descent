import { createGame } from "./game";

window.addEventListener("error", (event) => {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;top:0;left:0;right:0;padding:12px;background:#800;color:#fff;font:14px monospace;z-index:9999;white-space:pre-wrap";
  overlay.textContent = `ERROR: ${event.message}\n${event.filename}:${event.lineno}`;
  document.body.appendChild(overlay);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled rejection:", event.reason);
});

createGame("app");
