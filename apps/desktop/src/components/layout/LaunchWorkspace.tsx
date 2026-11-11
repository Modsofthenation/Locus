import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentRuntime, NamedEnvironment } from "@locus/shared";
import { folderName, loadIdeRecents, rememberIdeRecent } from "@/lib/ideRecents";
import { HostFolderPicker } from "@/components/workspace/HostFolderField";
import { IconFolder, IconLock } from "@/components/layout/Icons";
import { RuntimeToggle } from "@/components/settings/RuntimePicker";

export type LaunchWorkspaceSelection =
  | { kind: "private" }
  | { kind: "host"; path: string }
  | { kind: "environment"; env: NamedEnvironment };

type ListItem = {
  id: string;
  title: string;
  path: string;
  meta: string;
  selection: LaunchWorkspaceSelection;
  private?: boolean;
};

function runtimeCopy(runtime: AgentRuntime): {
  kicker: string;
  help: string;
  browseLabel: string;
} {
  if (runtime === "docker") {
    return {
      kicker: "Container",
      help: "Choose a named environment or the default image workdir.",
      browseLabel: "Environments",
    };
  }
  if (runtime === "vm") {
    return {
      kicker: "VM disk",
      help: "Pick the VM workspace the agent boots into. This is not a host path.",
      browseLabel: "Disks",
    };
  }
  return {
    kicker: "Workspace",
    help: "Pick a recent project or open a folder. Home, root, and credential directories are refused.",
    browseLabel: "Recent",
  };
}

function selectionKey(selection: LaunchWorkspaceSelection): string {
  if (selection.kind === "private") return "private";
  if (selection.kind === "host") return `host:${selection.path}`;
  return `env:${selection.env.id}`;
}

export function LaunchWorkspace(props: {
  runtime: AgentRuntime;
  remote?: boolean;
  hostDir: string;
  environments: NamedEnvironment[];
  selection: LaunchWorkspaceSelection;
  onSelect: (next: LaunchWorkspaceSelection) => void;
  onHostDir: (path: string) => void;
  /** When set, Docker / VM / Host sits in the workspace header instead of above the card. */
  onRuntimeChange?: (runtime: AgentRuntime) => void;
  runtimes?: AgentRuntime[];
  disabledRuntimes?: AgentRuntime[];
  /** Runtimes shown but not selectable, keyed to the tooltip reason. */
  unavailableRuntimes?: Partial<Record<AgentRuntime, string>>;
  /** Small badge beside the Workspace / Container / VM disk kicker (e.g. solo OS). */
  kickerBadge?: string;
  headerEnd?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [recentsTick, setRecentsTick] = useState(0);
  const copy = runtimeCopy(props.runtime);
  const canOpenFolder = props.runtime === "host" && !props.remote;
  const showRemotePath = Boolean(props.remote);
  const remotePathActive = showRemotePath && props.runtime === "host";
  const recents = useMemo(() => {
    void recentsTick;
    return loadIdeRecents();
  }, [recentsTick, open]);

  useEffect(() => {
    setOpen(false);
    setPickerOpen(false);
  }, [props.runtime, props.remote]);

  const items = useMemo((): ListItem[] => {
    if (props.runtime === "host") {
      const rows: ListItem[] = [
        {
          id: "private",
          title: "Private folder",
          path: "Empty directory for this chat · maps to /workspace",
          meta: "Isolated",
          selection: { kind: "private" },
          private: true,
        },
      ];
      for (const row of recents) {
        rows.push({
          id: `host:${row.path}`,
          title: row.title || folderName(row.path),
          path: row.path,
          meta: "Recent",
          selection: { kind: "host", path: row.path },
        });
      }
      if (
        props.hostDir.trim() &&
        !rows.some(
          (row) => row.selection.kind === "host" && row.selection.path === props.hostDir.trim(),
        )
      ) {
        rows.splice(1, 0, {
          id: `host:${props.hostDir.trim()}`,
          title: folderName(props.hostDir),
          path: props.hostDir.trim(),
          meta: "Selected",
          selection: { kind: "host", path: props.hostDir.trim() },
        });
      }
      return rows;
    }
    if (props.runtime === "docker") {
      const rows: ListItem[] = [
        {
          id: "default",
          title: "Default workdir",
          path: "/workspace in the session container",
          meta: "Image",
          selection: { kind: "private" },
          private: true,
        },
      ];
      for (const env of props.environments.filter((row) => row.runtime === "docker")) {
        rows.push({
          id: `env:${env.id}`,
          title: env.name,
          path: env.dockerImage ? `Named environment · ${env.dockerImage}` : "Named environment",
          meta: env.network ?? "Cached",
          selection: { kind: "environment", env },
        });
      }
      return rows;
    }
    const rows: ListItem[] = [
      {
        id: "fresh",
        title: "Fresh disk",
        path: "New overlay for this chat",
        meta: "Isolated",
        selection: { kind: "private" },
        private: true,
      },
    ];
    for (const env of props.environments.filter((row) => row.runtime === "vm")) {
      rows.push({
        id: `env:${env.id}`,
        title: env.name,
        path: "Named environment · persistent VM settings",
        meta: env.os,
        selection: { kind: "environment", env },
      });
    }
    return rows;
  }, [props.runtime, props.environments, props.hostDir, recents]);

  const selected =
    items.find((row) => selectionKey(row.selection) === selectionKey(props.selection)) ?? items[0]!;

  const badge =
    selected.private || selected.selection.kind === "private" ? (
      <>
        <span className="launch-dot" /> Isolated
      </>
    ) : (
      selected.meta
    );

  const showRuntimeToggle = typeof props.onRuntimeChange === "function";

  return (
    <div className="launch-workspace" data-testid="launch-workspace">
      <div className="launch-workspace-head">
        <div className="launch-workspace-head-start">
          <div className="launch-kicker">{copy.kicker}</div>
          {props.kickerBadge ? (
            <span className="launch-kicker-badge" data-testid="launch-kicker-badge">
              {props.kickerBadge}
            </span>
          ) : null}
        </div>
        {showRuntimeToggle || props.headerEnd ? (
          <div className="launch-workspace-head-end">
            {showRuntimeToggle ? (
              <RuntimeToggle
                value={props.runtime}
                onChange={props.onRuntimeChange!}
                runtimes={props.runtimes}
                disabledRuntimes={props.disabledRuntimes}
                unavailable={props.unavailableRuntimes}
              />
            ) : null}
            {props.headerEnd}
          </div>
        ) : null}
      </div>
      <div className={`launch-ws-row${open ? " is-open" : ""}`}>
        <button
          type="button"
          className="launch-ws-main"
          aria-expanded={open}
          aria-controls="launch-ws-picker"
          data-testid="launch-workspace-toggle"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="launch-tile" aria-hidden="true">
            {selected.private ? <IconLock /> : <IconFolder />}
          </span>
          <span className="launch-ws-copy">
            <strong>{selected.title}</strong>
            <span>{selected.path}</span>
          </span>
          <span className={`launch-chev${open ? " open" : ""}`} aria-hidden="true">
            ▾
          </span>
        </button>
        <span className="launch-ws-actions">
          <span className="launch-badge">{badge}</span>
          {canOpenFolder ? (
            <span className="launch-open-slot">
              <button
                type="button"
                className="btn small ghost"
                data-testid="launch-open-folder"
                onClick={() => setPickerOpen(true)}
              >
                Open folder
              </button>
            </span>
          ) : null}
        </span>
      </div>
      {showRemotePath ? (
        <label
          className={`launch-remote-path${remotePathActive ? "" : " is-spacer"}`}
          aria-hidden={!remotePathActive}
        >
          <span className="launch-kicker">Worker path</span>
          <input
            value={remotePathActive ? props.hostDir : ""}
            onChange={(event) => {
              if (!remotePathActive) return;
              const next = event.target.value;
              props.onHostDir(next);
              props.onSelect(
                next.trim() ? { kind: "host", path: next.trim() } : { kind: "private" },
              );
            }}
            placeholder="Leave empty for a per-session folder on the worker"
            spellCheck={false}
            aria-label="Workspace folder"
            data-testid="launch-remote-path"
            disabled={!remotePathActive}
            tabIndex={remotePathActive ? 0 : -1}
          />
        </label>
      ) : null}

      {open ? (
        <div
          className="launch-picker"
          id="launch-ws-picker"
          role="listbox"
          aria-label="Choose workspace"
        >
          <div className="launch-picker-head">
            <p className="launch-kicker">{copy.browseLabel}</p>
            <p className="hint">{copy.help}</p>
          </div>
          <div className="launch-picker-list">
            {items.map((item) => {
              const on = selectionKey(item.selection) === selectionKey(selected.selection);
              return (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`launch-picker-row${on ? " on" : ""}`}
                  data-testid={`launch-workspace-option-${item.id}`}
                  onClick={() => {
                    props.onSelect(item.selection);
                    if (item.selection.kind === "host") {
                      props.onHostDir(item.selection.path);
                      rememberIdeRecent(item.selection.path, item.title);
                      setRecentsTick((n) => n + 1);
                    } else if (item.selection.kind === "private" && props.runtime === "host") {
                      props.onHostDir("");
                    }
                    setOpen(false);
                  }}
                >
                  <span className="launch-tile" aria-hidden="true">
                    {item.private ? <IconLock /> : <IconFolder />}
                  </span>
                  <span>
                    <span className="name">{item.title}</span>
                    <span className="path">{item.path}</span>
                  </span>
                  <span className="meta">{item.meta}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <HostFolderPicker
        open={pickerOpen}
        initialPath={props.hostDir || undefined}
        title="Workspace folder"
        confirmLabel="Select folder"
        lead="This folder maps to /workspace for the agent."
        onClose={() => setPickerOpen(false)}
        onPick={(dir) => {
          props.onHostDir(dir);
          props.onSelect({ kind: "host", path: dir });
          rememberIdeRecent(dir);
          setRecentsTick((n) => n + 1);
          setOpen(false);
        }}
      />
    </div>
  );
}
