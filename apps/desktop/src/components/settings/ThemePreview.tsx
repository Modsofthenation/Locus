import { resolveTheme, themeOption } from "@locus/shared";
import { EmptyHero } from "@/components/layout/EmptyHero";

export function ThemePreview({
  theme,
  selected = false,
  hovering = false,
}: {
  theme: string;
  selected?: boolean;
  hovering?: boolean;
}) {
  const id = resolveTheme(theme);
  const opt = themeOption(id);
  const status = hovering ? "preview" : selected ? "selected" : "applied";
  return (
    <section className="theme-preview-panel" aria-label="Theme preview">
      <p className="theme-preview-label">
        <span>Preview · {opt.name}</span>
        <span className={`theme-preview-status ${status}`}>{status}</span>
      </p>
      <div
        className="theme-preview"
        data-theme={id}
        data-testid="theme-preview"
        {...(opt.gradient ? { "data-theme-gradient": "" } : {})}
        inert
      >
        <div className="theme-preview-chrome">
          <span />
          <span />
          <span />
          <em>New agent</em>
        </div>
        <div className="empty agent-start theme-preview-stage">
          <div className="empty-card">
            <EmptyHero
              pose="rest"
              size={44}
              title="What should we talk about?"
              lead="A coding agent on this machine. Pick a folder, or leave it empty for a private workspace."
            />
            <div className="runtime-toggle">
              <span>Docker</span>
              <span>VM</span>
              <span className="active">Host</span>
            </div>
            <div className="empty-composer">
              <textarea readOnly tabIndex={-1} placeholder="Ask a question…" value="" />
            </div>
            <div className="empty-actions">
              <span className="btn ghost">More options</span>
              <span className="btn primary">Start chat</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
