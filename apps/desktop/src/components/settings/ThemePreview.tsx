import { useEffect, useRef } from "react";
import { auditThemePreview, type RenderedContrastIssue } from "@/lib/themeAudit";
import type { CustomTheme } from "@locus/shared";
import { themeDisplayName, themeSurfaceAttrs } from "@/lib/theme";
import { EmptyHero } from "@/components/layout/EmptyHero";
import { IconReturn } from "@/components/layout/Icons";
import { NEW_AGENT_COPY } from "@/lib/launchCopy";

export function ThemePreview({
  theme,
  selected = false,
  hovering = false,
  customThemes,
  label,
  draft,
  onContrast,
}: {
  theme: string;
  selected?: boolean;
  hovering?: boolean;
  /** Generated themes to resolve `theme` against; defaults to the installed set. */
  customThemes?: readonly CustomTheme[];
  /** Overrides the status chip (e.g. "editing"). */
  label?: string;
  draft?: CustomTheme;
  onContrast?: (issues: RenderedContrastIssue[]) => void;
}) {
  const preview = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!draft || !onContrast || !preview.current) return;
    onContrast(auditThemePreview(preview.current, draft));
  }, [draft, onContrast]);
  const name = themeDisplayName(theme, customThemes);
  const status = label ?? (hovering ? "preview" : selected ? "selected" : "applied");
  return (
    <section className="theme-preview-panel" aria-label="Theme preview">
      <p className="theme-preview-label">
        <span>Preview · {name}</span>
        <span className={`theme-preview-status ${status}`}>{status}</span>
      </p>
      <div
        className="theme-preview"
        ref={preview}
        data-testid="theme-preview"
        data-theme-draft={draft ? "" : undefined}
        {...themeSurfaceAttrs(theme, customThemes)}
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
        {draft ? (
          <div className="theme-audit">
            <div className="theme-audit-buttons">
              <span className="btn primary small" data-audit-primary>
                Button
              </span>
              <span className="btn primary small" data-theme-audit-hover>
                Hover
              </span>
              <span className="btn small" data-theme-audit-focus>
                Focus
              </span>
            </div>
            <div className="sidebar">Sidebar</div>
            <div className="msg user">
              <div className="bubble">Your message</div>
            </div>
            <div className="msg assistant">
              <div className="bubble">Agent reply</div>
            </div>
            <pre className="md-code" data-testid="theme-preview-code">
              <span className="tok-cm">{"// code block"}</span>
              {"\n"}
              <span className="tok-kw">const</span> <span className="tok-fn">greet</span> ={" "}
              <span className="tok-str">&quot;hi&quot;</span>;
            </pre>
            <div className="patch-line add">+ added line</div>
            <div className="patch-line del">− removed line</div>
            <div className="theme-audit-terminal">
              Terminal <span className="theme-audit-cursor">▍</span>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
