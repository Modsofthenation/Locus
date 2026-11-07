function zoomAction(input) {
  if (!input || input.type !== "keyDown") return null;
  if (input.alt) return null;
  if (!(input.control || input.meta)) return null;
  const key = input.key ?? "";
  const code = input.code ?? "";
  if (code === "Equal" || code === "NumpadAdd" || key === "+" || key === "=") return "in";
  if (code === "Minus" || code === "NumpadSubtract" || key === "-" || key === "_") return "out";
  if (code === "Digit0" || code === "Numpad0" || key === "0") return "reset";
  return null;
}

function applyZoomLevel(current, action, step = 0.5, min = -3, max = 5) {
  const value = Number.isFinite(current) ? current : 0;
  if (action === "reset") return 0;
  if (action === "in") return Math.min(max, value + step);
  if (action === "out") return Math.max(min, value - step);
  return value;
}

module.exports = { zoomAction, applyZoomLevel };
