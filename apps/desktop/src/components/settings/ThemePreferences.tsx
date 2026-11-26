import { useId, useState } from "react";
import {
  THEME_OPTIONS,
  themeFitsScheme,
  type CustomTheme,
  type ThemeScheduleSlot,
  type ThemePreferences as Preferences,
  type ThemeRef,
} from "@locus/shared";

export interface ThemeWorkspace {
  key: string;
  label: string;
}

export function ThemePreferences({
  preferences,
  themes,
  workspaces,
  onChange,
}: {
  preferences?: Preferences;
  themes: readonly CustomTheme[];
  workspaces: readonly ThemeWorkspace[];
  onChange: (preferences: Preferences) => void;
}) {
  const [workspaceKey, setWorkspaceKey] = useState("");
  const formId = useId();
  const workspace = workspaces.find(({ key }) => workspaceKey === key);
  const accent = workspace && preferences?.workspaceAccents?.[workspace.key];
  const options = [...THEME_OPTIONS, ...themes];
  const workspaceTheme = workspace && preferences?.workspaceThemes?.[workspace.key];
  const schedule = preferences?.schedule ?? [];

  function setAccent(color?: string) {
    if (!workspace) return;
    const workspaceAccents = { ...preferences?.workspaceAccents };
    if (color) workspaceAccents[workspace.key] = color;
    else delete workspaceAccents[workspace.key];
    onChange({ ...preferences, workspaceAccents });
  }

  function setWorkspaceTheme(theme?: ThemeRef) {
    if (!workspace) return;
    const workspaceThemes = { ...preferences?.workspaceThemes };
    if (theme) workspaceThemes[workspace.key] = theme;
    else delete workspaceThemes[workspace.key];
    onChange({ ...preferences, workspaceThemes });
  }

  function setSchedule(next: ThemeScheduleSlot[]) {
    onChange({ ...preferences, schedule: next });
  }

  const themeSelect = (
    id: string,
    value: string,
    onPick: (id: ThemeRef) => void,
    label: string,
  ) => (
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(e) => onPick(e.target.value as ThemeRef)}
    >
      {options.map((theme) => (
        <option key={theme.id} value={theme.id}>
          {theme.name}
        </option>
      ))}
    </select>
  );

  return (
    <details className="theme-preferences">
      <summary>Automatic themes, schedules and workspace themes</summary>
      <div className="theme-editor-grid">
        <label>
          <input
            type="checkbox"
            checked={preferences?.followSystem ?? false}
            onChange={(event) => onChange({ ...preferences, followSystem: event.target.checked })}
          />
          Follow system appearance
        </label>
        {(["light", "dark"] as const).map((scheme) => (
          <div className="field" key={scheme}>
            <label htmlFor={`${formId}-${scheme}`}>
              {scheme === "light" ? "Light theme" : "Dark theme"}
            </label>
            <select
              id={`${formId}-${scheme}`}
              value={preferences?.[scheme] ?? (scheme === "light" ? "paper" : "ember")}
              onChange={(event) =>
                onChange({ ...preferences, [scheme]: event.target.value as ThemeRef })
              }
            >
              {options
                .filter((theme) => themeFitsScheme(theme.id, scheme, themes))
                .map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.name}
                  </option>
                ))}
            </select>
          </div>
        ))}
      </div>
      <div className="theme-schedule" data-testid="theme-schedule">
        <label>
          <input
            type="checkbox"
            checked={preferences?.scheduleOn ?? false}
            onChange={(event) =>
              onChange({
                ...preferences,
                scheduleOn: event.target.checked,
                schedule: schedule.length
                  ? schedule
                  : [
                      { at: "08:00", theme: preferences?.light ?? "paper" },
                      { at: "19:00", theme: preferences?.dark ?? "ember" },
                    ],
              })
            }
          />
          Switch themes by time of day
        </label>
        {preferences?.scheduleOn ? (
          <>
            <p className="theme-editor-hint">
              Each theme runs from its time until the next one. A schedule wins over following the
              system; a workspace theme wins over both.
            </p>
            {schedule.map((slot, index) => (
              <div className="theme-schedule-row" key={`${slot.at}-${index}`}>
                <input
                  type="time"
                  aria-label={`Slot ${index + 1} start`}
                  value={slot.at}
                  onChange={(event) =>
                    setSchedule(
                      schedule.map((row, i) =>
                        i === index ? { ...row, at: event.target.value } : row,
                      ),
                    )
                  }
                />
                {themeSelect(
                  `${formId}-slot-${index}`,
                  slot.theme,
                  (theme) =>
                    setSchedule(schedule.map((row, i) => (i === index ? { ...row, theme } : row))),
                  `Slot ${index + 1} theme`,
                )}
                <button
                  type="button"
                  className="btn small ghost"
                  aria-label={`Remove slot ${index + 1}`}
                  onClick={() => setSchedule(schedule.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </div>
            ))}
            {schedule.length < 8 ? (
              <button
                type="button"
                className="btn small"
                onClick={() => setSchedule([...schedule, { at: "12:00", theme: "ember" }])}
              >
                Add a time
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      {workspaces.length ? (
        <div className="theme-editor-grid">
          <div className="field">
            <label htmlFor={`${formId}-workspace`}>Workspace</label>
            <select
              id={`${formId}-workspace`}
              value={workspace?.key ?? ""}
              onChange={(event) => setWorkspaceKey(event.target.value)}
            >
              <option value="">Choose a project or repository</option>
              {workspaces.map(({ key, label }) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {workspace ? (
            <div className="field">
              <label htmlFor={`${formId}-accent`}>Workspace accent</label>
              <input
                id={`${formId}-accent`}
                type="color"
                value={accent ?? "#8169c3"}
                onChange={(event) => setAccent(event.target.value)}
              />
              {accent ? (
                <button type="button" className="btn small ghost" onClick={() => setAccent()}>
                  Clear accent
                </button>
              ) : null}
            </div>
          ) : null}
          {workspace ? (
            <div className="field">
              <label htmlFor={`${formId}-workspace-theme`}>Workspace theme</label>
              <select
                id={`${formId}-workspace-theme`}
                value={workspaceTheme ?? ""}
                onChange={(event) =>
                  setWorkspaceTheme((event.target.value || undefined) as ThemeRef | undefined)
                }
              >
                <option value="">Use the app theme</option>
                {options.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
