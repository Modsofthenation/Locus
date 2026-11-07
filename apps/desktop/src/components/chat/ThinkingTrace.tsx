import { useEffect, useState } from "react";

export function ThinkingTrace({ text, live }: { text: string; live?: boolean }) {
  const body = text.trim();
  const [open, setOpen] = useState(Boolean(live));
  useEffect(() => {
    if (live) setOpen(true);
  }, [live]);
  if (!body) return null;
  return (
    <details
      className="thinking-trace"
      data-testid="thinking-trace"
      open={open}
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="thinking-trace-label">{live ? "Thinking" : "Thought"}</span>
      </summary>
      <pre className="thinking-trace-body">{body}</pre>
    </details>
  );
}
