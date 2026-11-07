import { GUEST_SCREEN, overlayPosition, type ToolOverlay } from "@locus/shared";

export function DesktopOverlay({
  overlay,
  screen = GUEST_SCREEN,
}: {
  overlay: ToolOverlay;
  screen?: { width: number; height: number };
}) {
  const { left, top } = overlayPosition(overlay, screen);
  const label =
    overlay.key ??
    (overlay.text ? overlay.text.slice(0, 48) : undefined) ??
    overlay.title ??
    overlay.name.replaceAll("_", " ");
  const showPointer = overlay.x != null && overlay.y != null;

  return (
    <div className="desktop-overlay" aria-hidden>
      {showPointer ? (
        <span className="overlay-pointer" style={{ left, top }}>
          <span className="overlay-ring" />
        </span>
      ) : null}
      <span className="overlay-chip">{label}</span>
    </div>
  );
}
