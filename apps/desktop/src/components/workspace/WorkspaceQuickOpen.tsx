import { useEffect, useRef, useState } from "react";
import { api, type WorkspaceGrepHit, type WorkspaceIndexHit } from "@/lib/api";

export const WORKSPACE_GOTO_EVENT = "locus:workspace-goto";
export const WORKSPACE_GOTO_SYMBOL_EVENT = "locus:workspace-goto-symbol";
export const WORKSPACE_SEARCH_EVENT = "locus:workspace-search";
export const WORKSPACE_REINDEX_EVENT = "locus:workspace-reindex";
export const WORKSPACE_FORMAT_EVENT = "locus:workspace-format";
export const WORKSPACE_GIT_EVENT = "locus:workspace-git";
export const WORKSPACE_SPLIT_EVENT = "locus:workspace-split";

export function requestWorkspaceGoto(): void {
  window.dispatchEvent(new Event(WORKSPACE_GOTO_EVENT));
}

export function requestWorkspaceGotoSymbol(): void {
  window.dispatchEvent(new Event(WORKSPACE_GOTO_SYMBOL_EVENT));
}

export function requestWorkspaceSearch(): void {
  window.dispatchEvent(new Event(WORKSPACE_SEARCH_EVENT));
}

export function requestWorkspaceReindex(): void {
  window.dispatchEvent(new Event(WORKSPACE_REINDEX_EVENT));
}

export function requestWorkspaceFormat(): void {
  window.dispatchEvent(new Event(WORKSPACE_FORMAT_EVENT));
}

export function requestWorkspaceGit(): void {
  window.dispatchEvent(new Event(WORKSPACE_GIT_EVENT));
}

export function requestWorkspaceSplit(): void {
  window.dispatchEvent(new Event(WORKSPACE_SPLIT_EVENT));
}

function mergeWorkspaceHits(
  files: WorkspaceIndexHit[],
  symbols: WorkspaceIndexHit[],
  mode: "file" | "symbol",
): WorkspaceIndexHit[] {
  const extra = symbols.filter(
    (hit) =>
      !files.some(
        (row) => row.kind === "symbol" && row.path === hit.path && row.symbol === hit.symbol,
      ),
  );
  const fromIndex = mode === "symbol" ? files.filter((hit) => hit.kind === "symbol") : files;
  return [...extra, ...fromIndex].sort((a, b) => b.score - a.score).slice(0, 40);
}

export function WorkspaceQuickOpen({
  sessionId,
  open,
  mode = "file",
  onClose,
  onOpen,
}: {
  sessionId: string;
  open: boolean;
  mode?: "file" | "symbol";
  onClose: () => void;
  onOpen: (path: string, line?: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<WorkspaceIndexHit[]>([]);
  const [index, setIndex] = useState(0);
  const [fileCount, setFileCount] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const filesRef = useRef<WorkspaceIndexHit[]>([]);
  const symbolsRef = useRef<WorkspaceIndexHit[]>([]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setItems([]);
      setIndex(0);
      return;
    }
    queueMicrotask(() => input.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const token = (seq.current += 1);
    filesRef.current = [];
    symbolsRef.current = [];
    const needle = query.trim();
    const wait = needle ? 80 : 0;
    const timer = window.setTimeout(() => {
      void api
        .workspaceSearch(sessionId, needle, 40)
        .then((search) => {
          if (token !== seq.current) return;
          const files = (search.items ?? []) as WorkspaceIndexHit[];
          filesRef.current = files;
          setItems(mergeWorkspaceHits(files, symbolsRef.current, mode));
          setFileCount(search.fileCount);
          setIndex(0);
        })
        .catch(() => {
          if (token !== seq.current) return;
          filesRef.current = [];
          setItems(mergeWorkspaceHits([], symbolsRef.current, mode));
        });
      if (!needle || typeof api.workspaceSymbols !== "function") return;
      void api
        .workspaceSymbols(sessionId, needle, 24)
        .then((symbols) => {
          if (token !== seq.current) return;
          symbolsRef.current = (symbols.items ?? []) as WorkspaceIndexHit[];
          setItems(mergeWorkspaceHits(filesRef.current, symbolsRef.current, mode));
        })
        .catch(() => undefined);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [open, query, sessionId, mode]);

  if (!open) return null;

  const active = items[index];

  function pick(hit: WorkspaceIndexHit) {
    if (hit.kind === "symbol") {
      if (hit.line) {
        onOpen(hit.path, hit.line);
        onClose();
        return;
      }
      if (hit.symbol && typeof api.workspaceOutline === "function") {
        void api
          .workspaceOutline(sessionId, { path: hit.path })
          .then((res) => {
            const line = res.items?.find((item) => item.name === hit.symbol)?.line;
            onOpen(hit.path, line);
          })
          .catch(() => onOpen(hit.path));
        onClose();
        return;
      }
    }
    onOpen(hit.path);
    onClose();
  }

  return (
    <div
      className="workspace-quick-open-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="workspace-quick-open"
        role="dialog"
        aria-label={mode === "symbol" ? "Go to symbol" : "Go to file"}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setIndex((current) => (items.length ? (current + 1) % items.length : 0));
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setIndex((current) => (items.length ? (current - 1 + items.length) % items.length : 0));
            return;
          }
          if (event.key === "Enter" && active) {
            event.preventDefault();
            pick(active);
          }
        }}
      >
        <input
          ref={input}
          className="workspace-quick-open-input"
          value={query}
          placeholder={mode === "symbol" ? "Go to symbol" : "Go to file or symbol"}
          aria-label={mode === "symbol" ? "Go to symbol" : "Go to file or symbol"}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="workspace-quick-open-list" role="listbox">
          {items.length === 0 ? (
            <li className="workspace-quick-open-empty">
              {query.trim()
                ? "No matching files or symbols"
                : mode === "symbol"
                  ? "Type a symbol name"
                  : "Type to search the workspace index"}
            </li>
          ) : (
            items.map((hit, i) => (
              <li key={`${hit.kind}:${hit.path}:${hit.symbol ?? ""}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  className={`workspace-quick-open-item ${i === index ? "on" : ""}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => pick(hit)}
                >
                  <span className="workspace-quick-open-kind">
                    {hit.kind === "symbol" ? "fn" : "file"}
                  </span>
                  <span className="workspace-quick-open-label">
                    {hit.kind === "symbol" ? hit.symbol : hit.path.split("/").pop()}
                  </span>
                  <span className="workspace-quick-open-path">
                    {hit.kind === "symbol" ? hit.path : hit.path}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="workspace-quick-open-hint">
          {fileCount != null ? `${fileCount} indexed files` : "Indexing…"} · Enter to open
        </div>
      </div>
    </div>
  );
}

export function WorkspaceFileSearch({
  sessionId,
  open,
  onClose,
  onOpen,
}: {
  sessionId: string;
  open: boolean;
  onClose: () => void;
  onOpen: (path: string, line: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [replace, setReplace] = useState("");
  const [glob, setGlob] = useState("");
  const [exclude, setExclude] = useState("");
  const [regex, setRegex] = useState(false);
  const [items, setItems] = useState<WorkspaceGrepHit[]>([]);
  const [index, setIndex] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [pending, setPending] = useState(false);
  const [replaced, setReplaced] = useState<number | null>(null);
  const [grepError, setGrepError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setReplace("");
      setItems([]);
      setIndex(0);
      setTruncated(false);
      setPending(false);
      setReplaced(null);
      setGrepError(null);
      return;
    }
    queueMicrotask(() => input.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const needle = query.trim();
    if (needle.length < 2) {
      seq.current += 1;
      setItems([]);
      setTruncated(false);
      setPending(false);
      setReplaced(null);
      setGrepError(null);
      return;
    }
    const token = (seq.current += 1);
    setPending(true);
    const timer = window.setTimeout(() => {
      void api
        .workspaceGrep(sessionId, needle, 80, {
          glob: glob.trim() || undefined,
          exclude: exclude.trim() || undefined,
          regex,
        })
        .then((res) => {
          if (token !== seq.current) return;
          setItems(res.items ?? []);
          setTruncated(Boolean(res.truncated));
          setIndex(0);
          setPending(false);
          setReplaced(null);
          setGrepError(res.error ?? null);
        })
        .catch(() => {
          if (token !== seq.current) return;
          setItems([]);
          setTruncated(false);
          setPending(false);
          setGrepError(null);
        });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [open, query, sessionId, glob, exclude, regex]);

  if (!open) return null;

  const active = items[index];

  function pick(hit: WorkspaceGrepHit) {
    onOpen(hit.path, hit.line);
    onClose();
  }

  async function replaceAll() {
    const needle = query.trim();
    if (needle.length < 2) return;
    const token = (seq.current += 1);
    setPending(true);
    try {
      const res = await api.workspaceGrep(sessionId, needle, 80, {
        glob: glob.trim() || undefined,
        exclude: exclude.trim() || undefined,
        regex,
        replace,
      });
      if (token !== seq.current) return;
      setItems(res.items ?? []);
      setTruncated(Boolean(res.truncated));
      setReplaced(res.replaced ?? 0);
      setPending(false);
      setGrepError(res.error ?? null);
    } catch {
      if (token !== seq.current) return;
      setPending(false);
    }
  }

  return (
    <div
      className="workspace-quick-open-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="workspace-quick-open workspace-file-search"
        role="dialog"
        aria-label="Search in files"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setIndex((current) => (items.length ? (current + 1) % items.length : 0));
            return;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setIndex((current) => (items.length ? current - 1 + items.length : 0) % items.length);
            return;
          }
          if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && active) {
            event.preventDefault();
            pick(active);
          }
        }}
      >
        <input
          ref={input}
          className="workspace-quick-open-input"
          value={query}
          placeholder="Search in files"
          aria-label="Search in files"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="workspace-search-tools">
          <input
            className="workspace-quick-open-input"
            value={replace}
            placeholder="Replace"
            aria-label="Replace in files"
            onChange={(event) => setReplace(event.target.value)}
          />
          <input
            className="workspace-quick-open-input"
            value={glob}
            placeholder="Include glob · *.ts"
            aria-label="Include glob"
            onChange={(event) => setGlob(event.target.value)}
          />
          <input
            className="workspace-quick-open-input"
            value={exclude}
            placeholder="Exclude glob · dist/**"
            aria-label="Exclude glob"
            onChange={(event) => setExclude(event.target.value)}
          />
          <label className="workspace-search-regex">
            <input
              type="checkbox"
              checked={regex}
              onChange={(event) => setRegex(event.target.checked)}
            />
            Regex
          </label>
          <button
            type="button"
            className="btn small"
            disabled={pending || query.trim().length < 2}
            onClick={() => void replaceAll()}
          >
            Replace all
          </button>
        </div>
        <ul className="workspace-quick-open-list" role="listbox">
          {items.length === 0 ? (
            <li className="workspace-quick-open-empty">
              {query.trim().length < 2
                ? "Type at least two characters"
                : pending
                  ? "Searching…"
                  : grepError
                    ? grepError
                    : "No matching code"}
            </li>
          ) : (
            items.map((hit, i) => (
              <li key={`${hit.path}:${hit.line}:${i}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === index}
                  className={`workspace-quick-open-item ${i === index ? "on" : ""}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => pick(hit)}
                >
                  <span className="workspace-quick-open-kind">{hit.line}</span>
                  <span className="workspace-quick-open-label">{hit.text}</span>
                  <span className="workspace-quick-open-path">{hit.path}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="workspace-quick-open-hint">
          {replaced != null ? `Replaced ${replaced}${truncated ? " (partial)" : ""} · ` : ""}
          {truncated && replaced == null ? "Showing the first matches · " : ""}
          Enter opens the file at that line
        </div>
      </div>
    </div>
  );
}
