import { useMemo, useState, type ReactNode } from "react";
import {
  architectureSection,
  type ArchScope,
  type ArchSection,
  type ArchitectureAnalysis,
} from "@locus/shared";
import { api } from "@/lib/api";
import { useStore } from "@/state/store";

const SHOWN = 6;

export function ArchitecturePane({ repoId, repoName }: { repoId: string; repoName: string }) {
  const { dispatch } = useStore();
  const [report, setReport] = useState<ArchitectureAnalysis | null>(null);
  const [feature, setFeature] = useState("");
  const [file, setFile] = useState("");
  const [busy, setBusy] = useState<"analyse" | "suggest" | ArchScope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emphasis, setEmphasis] = useState<"analyse" | "suggest">("analyse");

  const featureOptions = report?.features ?? [];
  const fileOptions = useMemo(
    () => (report?.files ?? []).filter((row) => !feature || row.feature === feature),
    [report, feature],
  );

  async function analyse(nextEmphasis: "analyse" | "suggest" = "analyse") {
    setBusy("analyse");
    setError(null);
    setEmphasis(nextEmphasis);
    try {
      const next = await api.repoArchitecture(repoId);
      const nextFeature = next.features.some((row) => row.path === feature)
        ? feature
        : pickFeature(next);
      const inFeature = next.files.filter((row) => !nextFeature || row.feature === nextFeature);
      const nextFile = inFeature.some((row) => row.path === file) ? file : pickFile(inFeature);
      setReport(next);
      setFeature(nextFeature);
      setFile(nextFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not analyse this repo");
    } finally {
      setBusy(null);
    }
  }

  async function improve(scope: ArchScope) {
    const target = scope === "feature" ? feature : scope === "code" ? file : undefined;
    if ((scope === "feature" || scope === "code") && !target) {
      setError(
        scope === "feature" ? "Analyse, then pick a feature." : "Analyse, then pick a file.",
      );
      return;
    }
    setBusy(scope);
    setError(null);
    try {
      const session = await api.suggestArchitecture(repoId, { scope, target });
      dispatch({ type: "session", session });
      dispatch({ type: "select", id: session.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start an architecture agent");
    } finally {
      setBusy(null);
    }
  }

  const repoSection = report ? architectureSection(report, "repo") : placeholder(repoName, "repo");
  const featureSection = report
    ? architectureSection(report, "feature", feature)
    : placeholder(feature || "Feature", "feature");
  const codeSection = report
    ? architectureSection(report, "code", file)
    : placeholder(file || "Code", "code");

  return (
    <div className="architecture-pane" data-testid="architecture-pane">
      <div className="architecture-toolbar">
        <button className="btn small" disabled={busy !== null} onClick={() => void analyse()}>
          {busy === "analyse" ? "Analysing…" : "Analyse"}
        </button>
        <button
          className="btn small ghost"
          disabled={busy !== null}
          onClick={() => {
            if (report) setEmphasis("suggest");
            else void analyse("suggest");
          }}
        >
          Suggest improvements
        </button>
        {report?.checkout ? (
          <p className="meta">
            Checkout {report.checkout.label} ({report.checkout.runtime})
            {report.truncated ? " · scan capped" : ""}
          </p>
        ) : null}
        {report ? <p className="hint">{report.basis}</p> : null}
        {report?.unavailable ? <p className="hint">{report.unavailable}</p> : null}
        {!report ? (
          <p className="hint">
            Analyse reads a Host or Docker checkout on this machine. Suggest improvements lists
            behaviour-preserving changes from that pass. Improve with agent applies the ones that
            still hold.
          </p>
        ) : null}
        {error ? (
          <p className="error-row" role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <div className="architecture-sections">
        <SectionCard
          testId="architecture-repo"
          section={repoSection}
          emphasis={emphasis}
          busy={busy !== null}
          improving={busy === "repo"}
          onImprove={() => void improve("repo")}
        />
        <SectionCard
          testId="architecture-feature"
          section={featureSection}
          emphasis={emphasis}
          busy={busy !== null}
          improving={busy === "feature"}
          onImprove={() => void improve("feature")}
          control={
            <select
              aria-label="Feature"
              value={feature}
              disabled={!featureOptions.length}
              onChange={(event) => {
                const next = event.target.value;
                setFeature(next);
                const rows = (report?.files ?? []).filter((row) => row.feature === next);
                if (!rows.some((row) => row.path === file)) setFile(pickFile(rows));
              }}
            >
              {featureOptions.length ? null : <option value="">No features yet</option>}
              {featureOptions.map((row) => (
                <option key={row.path} value={row.path}>
                  {row.path} ({row.fileCount})
                </option>
              ))}
            </select>
          }
        />
        <SectionCard
          testId="architecture-code"
          section={codeSection}
          emphasis={emphasis}
          busy={busy !== null}
          improving={busy === "code"}
          onImprove={() => void improve("code")}
          control={
            <select
              aria-label="Code"
              value={file}
              disabled={!fileOptions.length}
              onChange={(event) => setFile(event.target.value)}
            >
              {fileOptions.length ? null : <option value="">No files yet</option>}
              {fileOptions.map((row) => (
                <option key={row.path} value={row.path}>
                  {row.path}
                  {row.flags.length ? ` · ${row.flags.length}` : ""}
                </option>
              ))}
            </select>
          }
        />
      </div>
    </div>
  );
}

function SectionCard({
  testId,
  section,
  emphasis,
  busy,
  improving,
  onImprove,
  control,
}: {
  testId: string;
  section: ArchSection;
  emphasis: "analyse" | "suggest";
  busy: boolean;
  improving: boolean;
  onImprove: () => void;
  control?: ReactNode;
}) {
  const findingsFirst = emphasis === "analyse";
  return (
    <section className="surface-pane architecture-section" data-testid={testId}>
      <header>
        <strong>{label(section.scope)}</strong>
        <button className="btn small ghost" disabled={busy} onClick={onImprove}>
          {improving ? "Starting…" : "Improve with agent"}
        </button>
      </header>
      <div className="architecture-body">
        {control ? <div className="field">{control}</div> : null}
        <p className="architecture-headline">{section.headline}</p>
        <Block title="How it is shaped" lines={section.how} />
        {findingsFirst ? (
          <>
            <FindingList rows={section.findings} />
            <SuggestionList rows={section.suggestions} emphasis={false} />
          </>
        ) : (
          <>
            <SuggestionList rows={section.suggestions} emphasis />
            <FindingList rows={section.findings} />
          </>
        )}
      </div>
    </section>
  );
}

function Block({ title, lines }: { title: string; lines: string[] }) {
  const shown = lines.slice(0, SHOWN);
  return (
    <div>
      <h4>{title}</h4>
      {shown.length ? (
        <ul className="architecture-list">
          {shown.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="hint">Nothing on this pass.</p>
      )}
      {lines.length > SHOWN ? <p className="meta">{lines.length - SHOWN} more</p> : null}
    </div>
  );
}

function FindingList({ rows }: { rows: ArchSection["findings"] }) {
  const shown = rows.slice(0, SHOWN);
  return (
    <div>
      <h4>Findings</h4>
      {shown.length ? (
        <ul className="architecture-list">
          {shown.map((row) => (
            <li key={row.id}>
              <span className="architecture-flag">{row.flag}</span> {row.title}
              <div className="meta">{row.detail}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">No red flags in this section.</p>
      )}
      {rows.length > SHOWN ? <p className="meta">{rows.length - SHOWN} more findings</p> : null}
    </div>
  );
}

function SuggestionList({
  rows,
  emphasis,
}: {
  rows: ArchSection["suggestions"];
  emphasis: boolean;
}) {
  const shown = rows.slice(0, SHOWN);
  return (
    <div className={emphasis ? "architecture-emphasis" : undefined}>
      <h4>Improvements</h4>
      {shown.length ? (
        <ul className="architecture-list">
          {shown.map((row) => (
            <li key={row.id}>
              {row.title}
              <div className="meta">{row.detail}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">No improvements in this section.</p>
      )}
      {rows.length > SHOWN ? <p className="meta">{rows.length - SHOWN} more improvements</p> : null}
    </div>
  );
}

function placeholder(target: string, scope: ArchScope): ArchSection {
  return {
    scope,
    target,
    headline: "Not analysed yet",
    how: [],
    findings: [],
    suggestions: [],
  };
}

function label(scope: ArchScope): string {
  if (scope === "repo") return "Repo";
  if (scope === "feature") return "Feature";
  return "Code";
}

function pickFeature(report: ArchitectureAnalysis): string {
  return (
    [...report.features].sort(
      (a, b) => b.findingCount - a.findingCount || a.path.localeCompare(b.path),
    )[0]?.path ?? ""
  );
}

function pickFile(files: ArchitectureAnalysis["files"]): string {
  return (
    [...files].sort((a, b) => b.flags.length - a.flags.length || a.path.localeCompare(b.path))[0]
      ?.path ?? ""
  );
}
