import { NATIVE_ENGINES, type NativeEngine } from "./launchTargets";

/** Sidebar preview for Unity / Godot / Unreal / Blender sessions, which have no HTML canvas to render. */
export function NativeProjectThumb({ engine }: { engine: NativeEngine }) {
  const info = NATIVE_ENGINES[engine];
  return (
    <div className="design-thumb native-project-thumb" data-engine={engine} aria-hidden="true">
      <span className="native-project-thumb-mark">{info.name.slice(0, 1)}</span>
      <span className="native-project-thumb-label">{info.name}</span>
    </div>
  );
}
