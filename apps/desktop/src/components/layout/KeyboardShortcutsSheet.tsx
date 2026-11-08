import { SHORTCUTS, shortcutDisplay } from "@/lib/shortcuts";

export function KeyboardShortcutsSheet() {
  return (
    <div className="palette-shortcuts" data-testid="palette-shortcuts">
      {SHORTCUTS.map((row) => (
        <div key={row.id} className="palette-shortcut">
          <span>{row.action}</span>
          <kbd>{shortcutDisplay(row.keys)}</kbd>
        </div>
      ))}
    </div>
  );
}
