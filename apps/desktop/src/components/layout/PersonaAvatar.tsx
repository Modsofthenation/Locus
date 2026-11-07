import type { CSSProperties } from "react";
import {
  HUB_AVATAR_ACCESSORIES,
  HUB_AVATAR_IDS,
  HUB_AVATAR_POSES,
  hubAvatarAccessoryLabel,
  hubAvatarAccent,
  hubAvatarLabel,
  parseHubAvatarAccessory,
  parseHubAvatarAccent,
  parseHubAvatarId,
  parseHubAvatarPose,
  type HubAvatarAccessory,
  type HubAvatarId,
  type HubAvatarPose,
} from "@locus/shared";
import { Mascot } from "@/components/layout/Mascot";

export type PersonaAvatarValue = {
  avatarId: HubAvatarId;
  avatarPose: HubAvatarPose;
  avatarAccessory: HubAvatarAccessory;
  avatarAccent?: string;
};

export function PersonaAvatar(props: {
  avatarId?: HubAvatarId | string | null;
  pose?: HubAvatarPose | string | null;
  accessory?: HubAvatarAccessory | string | null;
  accent?: string | null;
  size?: number;
  title?: string;
  className?: string;
}) {
  const id = parseHubAvatarId(props.avatarId);
  const pose = parseHubAvatarPose(props.pose);
  const accessory = parseHubAvatarAccessory(props.accessory);
  const accent = hubAvatarAccent(id, props.accent);
  const px = props.size ?? 28;
  return (
    <span
      className={["persona-avatar", props.className].filter(Boolean).join(" ")}
      data-avatar={id}
      data-accessory={accessory}
      data-testid="persona-avatar"
      style={{ "--persona-accent": accent, width: px, height: px } as CSSProperties}
      title={props.title}
    >
      <Mascot pose={pose} size={Math.round(px * 0.78)} title={props.title} />
      {accessory === "antenna" ? (
        <span className="persona-acc persona-acc-antenna" aria-hidden="true" />
      ) : null}
      {accessory === "badge" ? (
        <span className="persona-acc persona-acc-badge" aria-hidden="true" />
      ) : null}
      {accessory === "bow" ? (
        <span className="persona-acc persona-acc-bow" aria-hidden="true" />
      ) : null}
    </span>
  );
}

export function PersonaAvatarPicker(props: {
  value: PersonaAvatarValue;
  onChange: (next: PersonaAvatarValue) => void;
  /** `panel` puts preview beside controls to avoid vertical scroll. */
  layout?: "stack" | "panel";
}) {
  const selected = props.value;
  const accent = hubAvatarAccent(selected.avatarId, selected.avatarAccent);
  const layout = props.layout ?? "stack";
  const previewSize = layout === "panel" ? 88 : 56;

  function patch(partial: Partial<PersonaAvatarValue>) {
    props.onChange({ ...selected, ...partial });
  }

  return (
    <div
      className={`persona-avatar-editor${layout === "panel" ? " panel" : ""}`}
      data-testid="persona-avatar-editor"
      data-layout={layout}
    >
      <div className="persona-avatar-preview-row">
        <PersonaAvatar
          avatarId={selected.avatarId}
          pose={selected.avatarPose}
          accessory={selected.avatarAccessory}
          accent={selected.avatarAccent}
          size={previewSize}
          title={hubAvatarLabel(selected.avatarId)}
        />
        <p className="scrim-note persona-avatar-caption">
          {hubAvatarLabel(selected.avatarId)}
          {selected.avatarAccessory !== "none"
            ? ` · ${hubAvatarAccessoryLabel(selected.avatarAccessory)}`
            : ""}
          {selected.avatarPose !== "idle" ? ` · ${selected.avatarPose}` : ""}
        </p>
      </div>
      <div className="persona-avatar-controls">
        <div className="field">
          <span id="hub-avatar-preset-label">Preset</span>
          <div
            className="persona-avatar-picker"
            role="radiogroup"
            aria-labelledby="hub-avatar-preset-label"
          >
            {HUB_AVATAR_IDS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected.avatarId === id}
                className={selected.avatarId === id ? "on" : ""}
                data-testid={`persona-avatar-${id}`}
                title={hubAvatarLabel(id)}
                onClick={() =>
                  patch({
                    avatarId: id,
                    // Switching preset clears a custom accent so the new look shows.
                    avatarAccent: undefined,
                  })
                }
              >
                <PersonaAvatar
                  avatarId={id}
                  pose={selected.avatarPose}
                  accessory={selected.avatarAccessory}
                  size={layout === "panel" ? 32 : 36}
                  title={hubAvatarLabel(id)}
                />
              </button>
            ))}
          </div>
        </div>
        <div className="persona-avatar-option-row">
          <div className="field">
            <span id="hub-avatar-pose-label">Pose</span>
            <div
              className="theme-filter-pills"
              role="radiogroup"
              aria-labelledby="hub-avatar-pose-label"
            >
              {HUB_AVATAR_POSES.map((pose) => (
                <button
                  key={pose}
                  type="button"
                  role="radio"
                  aria-checked={selected.avatarPose === pose}
                  className={selected.avatarPose === pose ? "on" : ""}
                  data-testid={`persona-pose-${pose}`}
                  onClick={() => patch({ avatarPose: pose })}
                >
                  {pose}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span id="hub-avatar-acc-label">Accessory</span>
            <div
              className="theme-filter-pills"
              role="radiogroup"
              aria-labelledby="hub-avatar-acc-label"
            >
              {HUB_AVATAR_ACCESSORIES.map((row) => (
                <button
                  key={row}
                  type="button"
                  role="radio"
                  aria-checked={selected.avatarAccessory === row}
                  className={selected.avatarAccessory === row ? "on" : ""}
                  data-testid={`persona-accessory-${row}`}
                  onClick={() => patch({ avatarAccessory: row })}
                >
                  {hubAvatarAccessoryLabel(row)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="field persona-accent-field">
          <label htmlFor="hub-avatar-accent">Accent</label>
          <div className="persona-accent-row">
            <input
              id="hub-avatar-accent"
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : "#c9a227"}
              data-testid="persona-accent-color"
              onChange={(event) => {
                const next = parseHubAvatarAccent(event.target.value);
                patch({ avatarAccent: next });
              }}
            />
            <input
              type="text"
              value={selected.avatarAccent ?? ""}
              placeholder={hubAvatarAccent(selected.avatarId)}
              data-testid="persona-accent-hex"
              onChange={(event) => {
                const raw = event.target.value.trim();
                if (!raw) {
                  patch({ avatarAccent: undefined });
                  return;
                }
                const next = parseHubAvatarAccent(raw.startsWith("#") ? raw : `#${raw}`);
                if (next) patch({ avatarAccent: next });
              }}
            />
            {selected.avatarAccent ? (
              <button
                type="button"
                className="btn small ghost"
                onClick={() => patch({ avatarAccent: undefined })}
              >
                Reset
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
