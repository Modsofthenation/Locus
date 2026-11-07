export type HypervisorStatus = {
  kind: string;
  capabilities: {
    qemuBinary: string | null;
    qemuImgBinary: string | null;
    swtpmBinary: string | null;
    ovmfCodePath: string | null;
    ovmfVarsPath: string | null;
    hasKvm: boolean;
    kvmUsable?: boolean;
    accelerator?: string;
  } | null;
};

export type ShareFile = {
  name: string;
  size: number;
  mtime: string;
  guestPath: string;
};

export type WorkspaceEntry = {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
};

export type WorkspaceFileChange = {
  path: string;
  additions: number;
  deletions: number;
};

export type WorkspaceIndexHit = {
  path: string;
  kind: "file" | "symbol";
  symbol?: string;
  score: number;
  line?: number;
};

export type WorkspaceIndexStatus = {
  status: "idle" | "building" | "ready";
  fileCount: number;
  scanned: number;
  reused?: number;
  read?: number;
  builtAt?: string;
  truncated?: boolean;
};

export type WorkspaceGrepHit = {
  path: string;
  line: number;
  text: string;
};

export type WorkspaceDiagnostic = {
  path: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  message: string;
  severity: "error" | "warning" | "info";
};

export type WorkspaceDebugState = {
  status: "idle" | "running" | "paused" | "stopped" | "error";
  sessionId: string;
  program?: string;
  error?: string;
  breakpoints: Array<{ path: string; line: number }>;
  stack: Array<{ id: number; name: string; path: string; line: number }>;
  variables: Array<{ name: string; value: string }>;
};

export type WorkspaceHover = {
  text: string;
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
};

export type WorkspaceLocation = {
  path: string;
  line: number;
  character: number;
};

export type WorkspaceHighlight = {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  kind: "write" | "read" | "text";
};

export type WorkspaceSignatureHelp = {
  label: string;
  documentation?: string;
  activeParameter: number;
  parameters: Array<{ label: string; documentation?: string }>;
};

export type WorkspaceGitFile = {
  path: string;
  index: string;
  worktree: string;
  staged: boolean;
  conflicted?: boolean;
};

export type WorkspaceGitStatus = {
  branch: string;
  ahead: number;
  behind: number;
  files: WorkspaceGitFile[];
  rebasing?: boolean;
  merging?: boolean;
  upstream?: string;
  dest?: string;
  dests?: Array<{ dest: string; name: string; url?: string; primary?: boolean }>;
};

export type WorkspaceGitHunk = {
  path: string;
  staged: boolean;
  header: string;
  patch: string;
  oldStart: number;
  newStart: number;
  lines: Array<{ kind: "ctx" | "add" | "del"; text: string }>;
};

export type WorkspaceGitStash = {
  index: number;
  ref: string;
  message: string;
};

export type WorkspaceGitRebaseTodo = {
  action: "pick" | "reword" | "squash" | "fixup" | "drop";
  sha: string;
  message: string;
};

export type WorkspaceGitRebaseStatus = {
  onto: string;
  todos: WorkspaceGitRebaseTodo[];
  rebasing: boolean;
  conflicted: string[];
};

export type WorkspaceBlameLine = {
  sha: string;
  author: string;
  date: string;
  line: number;
  text: string;
};

export type WorkspaceOutlineItem = {
  name: string;
  line: number;
};

export type WorkspaceCompletionItem = {
  label: string;
  insert: string;
  kind: string;
  detail?: string;
  additionalEdits?: Array<{
    path: string;
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
    newText: string;
  }>;
};
