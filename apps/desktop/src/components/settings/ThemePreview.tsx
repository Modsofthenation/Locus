import { resolveTheme, themeOption } from "@locus/shared";
import { EmptyHero } from "@/components/layout/EmptyHero";
import { IconReturn } from "@/components/layout/Icons";
import { NEW_AGENT_COPY } from "@/lib/launchCopy";

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
              title={NEW_AGENT_COPY.heading}
              lead={NEW_AGENT_COPY.lead}
            />
            <div className="runtime-toggle">
              <span>Docker</span>
              <span>VM</span>
              <span className="active">Host</span>
            </div>
            <div className="empty-composer">
              <textarea readOnly tabIndex={-1} placeholder={NEW_AGENT_COPY.placeholder} value="" />
              <div className="empty-composer-bar">
                <div className="composer-toolbar-end">
                  <span className="btn primary small composer-send">
                    <span className="composer-send-label">{NEW_AGENT_COPY.send}</span>
                    <IconReturn />
                  </span>
                </div>
              </div>
            </div>
            <div className="empty-actions">
              <span className="btn ghost">{NEW_AGENT_COPY.moreOptions}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
