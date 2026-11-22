/** Unified diff with add / delete / meta lines tinted. */
export function DiffBlock({ diff }: { diff: string }) {
  if (!diff.trim()) return <p className="hint">No changes yet.</p>;
  return (
    <pre className="workers-board-diff" aria-label="Diff">
      {diff.split("\n").map((line, i) => (
        <span
          key={i}
          className={
            line.startsWith("+") && !line.startsWith("+++")
              ? "is-add"
              : line.startsWith("-") && !line.startsWith("---")
                ? "is-del"
                : line.startsWith("@@") || line.startsWith("diff --git")
                  ? "is-meta"
                  : undefined
          }
        >
          {line}
          {"\n"}
        </span>
      ))}
    </pre>
  );
}
