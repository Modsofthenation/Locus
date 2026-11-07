import {
  PALETTE_PRESETS,
  PALETTE_ROLES,
  PALETTE_ROLE_LABELS,
  isBuiltinDesignSystemId,
  normalizeHex,
  presetIdForPalette,
  type DesignPalette,
  type DesignSystem,
  type PalettePreset,
  type PaletteRole,
} from "@locus/shared";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useStore } from "@/state/store";
import { fixedContainingOrigin, placeMenuPop } from "@/components/layout/OverflowMenu";

function palettesEqual(a: DesignPalette, b: DesignPalette): boolean {
  return PALETTE_ROLES.every((role) => a[role] === b[role]);
}

export function palettePresetsFromSystems(systems: DesignSystem[]): PalettePreset[] {
  const seen = new Set<string>();
  const extras: PalettePreset[] = [];
  for (const row of systems) {
    if (isBuiltinDesignSystemId(row.id)) continue;
    const key = PALETTE_ROLES.map((role) => row.palette[role]).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push({
      id: row.id,
      name: row.name,
      summary: row.summary || row.name,
      colors: { ...row.palette },
    });
  }
  return extras;
}

function PresetButton(props: {
  preset: PalettePreset;
  selected: boolean;
  onChange: (palette: DesignPalette) => void;
}) {
  return (
    <button
      type="button"
      className={`palette-preset ${props.selected ? "on" : ""}`}
      title={props.preset.summary}
      aria-pressed={props.selected}
      onClick={() => props.onChange({ ...props.preset.colors })}
    >
      <span className="palette-preset-swatches">
        {PALETTE_ROLES.slice(0, 4).map((role) => (
          <span key={role} style={{ background: props.preset.colors[role] }} />
        ))}
      </span>
      <span>{props.preset.name}</span>
    </button>
  );
}

export function DesignPalettePicker(props: {
  palette: DesignPalette;
  onChange: (palette: DesignPalette) => void;
  compact?: boolean;
}) {
  const { state } = useStore();
  const [open, setOpen] = useState(!props.compact);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const popSize = useRef<{ width: number; height: number } | null>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);
  const stored = palettePresetsFromSystems(state.designSystems);
  const selected =
    stored.find((preset) => palettesEqual(preset.colors, props.palette))?.id ??
    presetIdForPalette(props.palette);

  useEffect(() => {
    if (!props.compact || !open) return;
    function onDoc(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, props.compact]);

  useLayoutEffect(() => {
    if (!props.compact || !open) {
      popSize.current = null;
      setPlace(null);
      return;
    }
    function relayout() {
      const button = trigger.current;
      const menu = pop.current;
      if (!button || !menu) {
        setPlace(null);
        return;
      }
      const origin = fixedContainingOrigin(menu);
      const rect = menu.getBoundingClientRect();
      if (!popSize.current && rect.width > 0 && rect.height > 0) {
        popSize.current = { width: rect.width, height: rect.height };
      }
      const next = placeMenuPop({
        trigger: button.getBoundingClientRect(),
        pop: popSize.current ?? { width: rect.width || 320, height: rect.height || 360 },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        origin,
        align: "right",
      });
      setPlace({ top: next.top, left: next.left });
    }
    relayout();
    window.addEventListener("resize", relayout);
    window.addEventListener("scroll", relayout, true);
    return () => {
      window.removeEventListener("resize", relayout);
      window.removeEventListener("scroll", relayout, true);
    };
  }, [open, props.compact, stored.length, props.palette]);

  function setRole(role: PaletteRole, raw: string) {
    const hex = normalizeHex(raw);
    if (!hex) return;
    props.onChange({ ...props.palette, [role]: hex });
  }

  const editor = (
    <div className="palette-editor">
      <div className="palette-presets" role="group" aria-label="Palette presets">
        {stored.length ? (
          <>
            <div className="palette-preset-group">My systems</div>
            {stored.map((preset) => (
              <PresetButton
                key={preset.id}
                preset={preset}
                selected={selected === preset.id}
                onChange={props.onChange}
              />
            ))}
            <div className="palette-preset-group">Starters</div>
          </>
        ) : null}
        {PALETTE_PRESETS.map((preset) => (
          <PresetButton
            key={preset.id}
            preset={preset}
            selected={selected === preset.id}
            onChange={props.onChange}
          />
        ))}
      </div>
      <div className="palette-roles">
        {PALETTE_ROLES.map((role) => (
          <label key={role} className="palette-role">
            <span>{PALETTE_ROLE_LABELS[role]}</span>
            <span className="palette-role-inputs">
              <input
                type="color"
                aria-label={PALETTE_ROLE_LABELS[role]}
                value={props.palette[role]}
                onChange={(e) => setRole(role, e.target.value)}
              />
              <input
                type="text"
                spellCheck={false}
                value={props.palette[role]}
                onChange={(e) => setRole(role, e.target.value)}
              />
            </span>
          </label>
        ))}
      </div>
    </div>
  );

  if (!props.compact) {
    return (
      <div className="palette-picker">
        <div className="field-label">Color palette</div>
        {editor}
      </div>
    );
  }

  const popStyle: CSSProperties | undefined = place
    ? { top: place.top, left: place.left }
    : undefined;

  return (
    <div className="palette-picker compact" ref={root}>
      <button
        ref={trigger}
        type="button"
        className={`palette-swatch-row ${open ? "on" : ""}`}
        aria-expanded={open}
        aria-label="Color palette"
        title="Color palette"
        onClick={() => setOpen((v) => !v)}
      >
        {PALETTE_ROLES.map((role) => (
          <span
            key={role}
            style={{ background: props.palette[role] }}
            title={PALETTE_ROLE_LABELS[role]}
          />
        ))}
      </button>
      {open ? (
        <div ref={pop} className={`palette-pop${place ? " placed" : ""}`} style={popStyle}>
          {editor}
        </div>
      ) : null}
    </div>
  );
}
