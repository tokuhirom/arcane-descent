import { createGame } from "./game";

window.addEventListener("error", (event) => {
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;bottom:0;left:0;right:0;padding:12px;background:#800;color:#fff;font:12px monospace;z-index:99999;white-space:pre-wrap;max-height:40vh;overflow:auto";
  overlay.textContent = `ERROR: ${event.message}\n${event.filename}:${event.lineno}`;
  document.body.appendChild(overlay);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled rejection:", event.reason);
});

document.addEventListener("touchmove", (e) => e.preventDefault(), { passive: false });
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.body.style.overscrollBehavior = "none";
document.body.style.touchAction = "none";

createGame("app");
