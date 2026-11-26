import { useId, useState } from "react";
import {
  MAX_THEME_PACK_BYTES,
  exportThemePack,
  importThemePack,
  type CustomTheme,
  type ThemePack,
} from "@locus/shared";
import { downloadTextFile } from "@/lib/chatExport";

export function ThemePackSettings({
  themes,
  onPreview,
}: {
  themes: readonly CustomTheme[];
  onPreview: (pack: ThemePack) => void;
}) {
  const formId = useId();
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [ids, setIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const selected = themes.filter((theme) => ids.includes(theme.id));

  function preview(contents: string) {
    try {
      onPreview(
        importThemePack(
          contents,
          themes.map(({ id }) => id),
        ),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the theme pack");
    }
  }

  async function openFile(file: File) {
    try {
      if (file.size > MAX_THEME_PACK_BYTES) throw new Error("The theme pack is too large");
      preview(await file.text());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the file");
    }
  }

  function download() {
    try {
      downloadTextFile(
        exportThemePack(name, selected),
        "locus-theme-pack.json",
        "application/json",
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export the theme pack");
    }
  }

  return (
    <details className="theme-pack">
      <summary>Import and export theme packs</summary>
      <div className="theme-import">
        <div className="field">
          <label htmlFor={`${formId}-file`}>Open JSON file</label>
          <input
            id={`${formId}-file`}
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void openFile(file);
              event.target.value = "";
            }}
          />
        </div>
        <div className="field">
          <label htmlFor={`${formId}-json`}>Or paste theme JSON</label>
          <textarea
            id={`${formId}-json`}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn small"
          disabled={!text.trim()}
          onClick={() => preview(text)}
        >
          Preview import
        </button>
      </div>
      {themes.length ? (
        <div className="theme-import">
          <div className="field">
            <label htmlFor={`${formId}-name`}>Pack name</label>
            <input
              id={`${formId}-name`}
              maxLength={60}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="theme-pack-variants" role="group" aria-label="Variants to export">
            {themes.map((theme) => (
              <label key={theme.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(theme.id)}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setIds((prev) =>
                      checked ? [...prev, theme.id] : prev.filter((id) => id !== theme.id),
                    );
                  }}
                />
                {theme.name} ({theme.scheme})
              </label>
            ))}
          </div>
          <button
            type="button"
            className="btn small"
            disabled={!selected.length}
            onClick={download}
          >
            Export selected variants
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="theme-editor-error" role="alert">
          {error}
        </p>
      ) : null}
    </details>
  );
}
