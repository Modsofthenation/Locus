export function scaleClick(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  screen: { width: number; height: number },
): { x: number; y: number } {
  const x = Math.round(((clientX - rect.left) / Math.max(rect.width, 1)) * screen.width);
  const y = Math.round(((clientY - rect.top) / Math.max(rect.height, 1)) * screen.height);
  return {
    x: Math.min(screen.width, Math.max(0, x)),
    y: Math.min(screen.height, Math.max(0, y)),
  };
}
