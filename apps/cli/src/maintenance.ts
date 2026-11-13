/**
 * `locus backup`, `locus restore`, `locus update` and `locus eval`.
 * Kept out of commands.ts so that file only carries the route entries.
 */
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import {
  BENCHMARK_CASES,
  benchmarkTargetKey,
  formatUsd,
  parseBenchmarkTarget,
  type BenchmarkRun,
  type BenchmarkTargetSummary,
} from "@locus/shared";
import { UsageError, flagBool, flagList, flagNum, flagStr, need } from "./args.js";
import { formatKv, formatTable as formatColumns, printJson } from "./format.js";
import { CLI_VERSION } from "./version.js";
import type { Ctx } from "./commands.js";

export const PASSPHRASE_ENV = "LOCUS_BACKUP_PASSPHRASE";

function done<T>(ctx: Ctx, value: T, text: () => string): void {
  if (ctx.json) printJson(ctx.writeln, value);
  else ctx.writeln(text());
}

/** Header list + string rows → the shared column table. */
function formatTable(headers: string[], rows: string[][]): string {
  return formatColumns(
    rows,
    headers.map((header, i) => ({
      key: header,
      header,
      width: Math.max(header.length, ...rows.map((row) => (row[i] ?? "").length)),
      value: (row: string[]) => row[i] ?? "",
    })),
  );
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

/** Read without echo. Only used on an interactive terminal. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolvePromise) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    const out = rl as unknown as {
      _writeToOutput?: (s: string) => void;
      output: NodeJS.WriteStream;
    };
    let asked = false;
    out._writeToOutput = (s: string) => {
      if (!asked) {
        process.stderr.write(s);
        return;
      }
      if (s.includes("\n")) process.stderr.write("\n");
    };
    rl.question(question, (answer) => {
      rl.close();
      resolvePromise(answer);
    });
    asked = true;
  });
}

/**
 * Passphrase from `--passphrase-env NAME` (default LOCUS_BACKUP_PASSPHRASE), else a hidden
 * prompt. Never a plain flag, so it does not land in shell history or `ps`.
 */
export async function readPassphrase(
  ctx: Ctx,
  opts: { confirm: boolean; env?: NodeJS.ProcessEnv; tty?: boolean; prompt?: typeof promptHidden },
): Promise<string> {
  const env = opts.env ?? process.env;
  const name = flagStr(ctx.flags, "passphrase-env") ?? PASSPHRASE_ENV;
  const fromEnv = env[name];
  if (fromEnv) return fromEnv;
  const tty = opts.tty ?? Boolean(process.stdin.isTTY);
  if (!tty) {
    throw new UsageError(`Set ${name} (or --passphrase-env NAME) to the backup passphrase.`);
  }
  const ask = opts.prompt ?? promptHidden;
  const first = await ask("Backup passphrase: ");
  if (opts.confirm) {
    const again = await ask("Repeat passphrase: ");
    if (again !== first) throw new UsageError("Passphrases did not match.");
  }
  return first;
}

interface BackupResponse {
  path: string;
  sizeBytes: number;
  manifest: { files: number; bytes: number; includeDisks: boolean; skipped: string[] };
}

export async function cmdBackup(
  ctx: Ctx,
  deps: Parameters<typeof readPassphrase>[1] = { confirm: true },
): Promise<void> {
  const out = ctx.args[0] ?? flagStr(ctx.flags, "out");
  const passphrase = await readPassphrase(ctx, { ...deps, confirm: true });
  const result = await ctx.client.post<BackupResponse>("/api/backup", {
    passphrase,
    out: out ? resolve(out) : undefined,
    includeDisks: flagBool(ctx.flags, "include-disks"),
    appVersion: CLI_VERSION,
  });
  done(ctx, result, () => {
    const lines = [
      `Backed up ${result.manifest.files} files (${bytes(result.manifest.bytes)}) to ${result.path}`,
      `Archive: ${bytes(result.sizeBytes)}, encrypted with your passphrase.`,
    ];
    if (!result.manifest.includeDisks)
      lines.push("VM disks and images were left out (--include-disks).");
    if (result.manifest.skipped.length) {
      lines.push(
        `Could not read ${result.manifest.skipped.length}: ${result.manifest.skipped.slice(0, 5).join(", ")}`,
      );
    }
    return lines.join("\n");
  });
}

export async function cmdRestore(
  ctx: Ctx,
  deps: Parameters<typeof readPassphrase>[1] = { confirm: false },
): Promise<void> {
  const sub = ctx.args[0];
  if (sub === "status") {
    const result = await ctx.client.get<{ pending: { stagedAt: string; from: string } | null }>(
      "/api/restore",
    );
    done(ctx, result, () =>
      result.pending
        ? `Restore of ${result.pending.from} is staged (${result.pending.stagedAt}). Restart Locus to apply it.`
        : "No restore is staged.",
    );
    return;
  }
  if (sub === "cancel") {
    const result = await ctx.client.delete<{ ok: true }>("/api/restore");
    done(ctx, result, () => "Cancelled the staged restore.");
    return;
  }
  const path = resolve(need(ctx.args, 0, "backup file"));
  const passphrase = await readPassphrase(ctx, { ...deps, confirm: false });
  if (flagBool(ctx.flags, "inspect")) {
    const manifest = await ctx.client.post<Record<string, unknown>>("/api/backup/inspect", {
      path,
      passphrase,
    });
    done(ctx, manifest, () =>
      formatKv([
        ["Created", String(manifest.createdAt ?? "")],
        ["Locus", String(manifest.appVersion ?? "unknown")],
        ["From", `${String(manifest.dataDir ?? "")} (${String(manifest.platform ?? "")})`],
        ["Files", String(manifest.files ?? 0)],
        ["Size", bytes(Number(manifest.bytes ?? 0))],
        ["VM disks", manifest.includeDisks ? "included" : "not included"],
      ]),
    );
    return;
  }
  if (!ctx.flags.yes) {
    throw new UsageError(
      "Restore replaces this machine's Locus data at the next start (the current files are kept under ~/.locus/.before-restore-*). Re-run with --yes.",
    );
  }
  const result = await ctx.client.post<{ files: number; manifest: { createdAt: string } }>(
    "/api/restore",
    { path, passphrase },
  );
  done(ctx, result, () =>
    [
      `Staged ${result.files} files from the backup made ${result.manifest.createdAt}.`,
      "Quit and reopen Locus (or restart `locus serve`) to finish the restore.",
    ].join("\n"),
  );
}

type UpdateInfo = {
  status: "available" | "up-to-date" | "unavailable";
  current: string;
  latest?: string;
  htmlUrl?: string;
  asset?: { name: string; url: string };
  checksums?: { name: string; url: string };
  message?: string;
};

export async function cmdUpdate(ctx: Ctx): Promise<void> {
  const current = flagStr(ctx.flags, "current") ?? CLI_VERSION;
  const info = await ctx.client.get<UpdateInfo>(
    `/api/updates?current=${encodeURIComponent(current)}&refresh=1`,
  );
  if (ctx.args[0] === "download") {
    if (info.status !== "available") {
      done(ctx, info, () => `Locus ${current} is current.`);
      return;
    }
    if (!info.asset || !info.checksums) {
      throw new UsageError(
        `No verified installer for this platform. See ${info.htmlUrl ?? "GitHub releases"}.`,
      );
    }
    const saved = await ctx.client.post<{ path: string; sha256: string }>("/api/updates/download", {
      asset: info.asset,
      checksums: info.checksums,
    });
    done(ctx, saved, () => `Verified against ${info.checksums!.name}. Saved to ${saved.path}`);
    return;
  }
  done(ctx, info, () => {
    if (info.status === "available") {
      const latest = (info.latest ?? "").replace(/^v/i, "");
      return [
        `Locus ${latest} is available (you have ${current}).`,
        info.asset
          ? `Installer: ${info.asset.name}. Run \`locus update download\` to fetch and verify it.`
          : "",
        info.htmlUrl ? `Release notes: ${info.htmlUrl}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
    if (info.status === "up-to-date") return `Locus ${current} is the latest release.`;
    return info.message ?? "Could not check for updates.";
  });
}

type RunWithSummary = BenchmarkRun & { summary: BenchmarkTargetSummary[] };

function summaryTable(run: RunWithSummary): string {
  return formatTable(
    ["Model", "Passed", "Rate", "Cost", "Median time", "Tokens"],
    run.summary.map((row) => [
      benchmarkTargetKey(row.target),
      `${row.passed}/${row.total}`,
      row.total ? `${Math.round(row.passRate * 100)}%` : "-",
      row.usd != null ? formatUsd(row.usd) : "-",
      row.medianMs ? `${Math.round(row.medianMs / 1000)}s` : "-",
      row.tokens ? row.tokens.toLocaleString("en-US") : "-",
    ]),
  );
}

function runDetail(run: RunWithSummary): string {
  const header = `${run.id} · ${run.status}${run.error ? ` (${run.error})` : ""}`;
  const cases = formatTable(
    ["Case", "Model", "Try", "Result", "Why", "Time"],
    run.results.map((row) => [
      row.caseId,
      benchmarkTargetKey(row.target),
      String(row.attempt),
      row.status,
      row.reason ?? "",
      row.durationMs ? `${Math.round(row.durationMs / 1000)}s` : "",
    ]),
  );
  return [header, "", summaryTable(run), "", cases].join("\n");
}

export async function cmdEvalCases(ctx: Ctx): Promise<void> {
  const rows = BENCHMARK_CASES.map(({ id, title }) => ({ id, title }));
  done(ctx, rows, () =>
    formatTable(
      ["Case", "What it tests"],
      rows.map((r) => [r.id, r.title]),
    ),
  );
}

export async function cmdEvalRun(ctx: Ctx): Promise<void> {
  const raw = [...flagList(ctx.flags, "model"), ...ctx.args];
  if (!raw.length)
    throw new UsageError("Pass --model provider/model (repeatable or comma-separated).");
  const targets = raw.map((value) => {
    const target = parseBenchmarkTarget(value);
    if (!target) throw new UsageError(`Use provider/model, for example openai/gpt-5: ${value}`);
    return target;
  });
  const timeoutMin = flagNum(ctx.flags, "timeout");
  let run = await ctx.client.post<RunWithSummary>("/api/benchmarks", {
    targets,
    caseIds: flagList(ctx.flags, "case"),
    repeat: flagNum(ctx.flags, "repeat"),
    timeoutMs: timeoutMin ? timeoutMin * 60_000 : undefined,
  });
  if (!flagBool(ctx.flags, "wait")) {
    done(
      ctx,
      run,
      () =>
        `Started ${run.id}: ${run.results.length} case runs. Follow it with \`locus eval show ${run.id}\`.`,
    );
    return;
  }
  const pollMs = flagNum(ctx.flags, "poll-ms") ?? 3000;
  let reported = 0;
  while (run.status === "running") {
    await new Promise((r) => setTimeout(r, pollMs));
    run = await ctx.client.get<RunWithSummary>(`/api/benchmarks/${encodeURIComponent(run.id)}`);
    if (!ctx.json) {
      const finished = run.results.filter((r) => r.status !== "pending" && r.status !== "running");
      for (const row of finished.slice(reported)) {
        ctx.err(
          `${row.status === "passed" ? "✓" : "✗"} ${row.caseId} · ${benchmarkTargetKey(row.target)} · ${row.reason ?? ""}`,
        );
      }
      reported = finished.length;
    }
  }
  done(ctx, run, () => runDetail(run));
}

export async function cmdEvalList(ctx: Ctx): Promise<void> {
  const { runs } = await ctx.client.get<{ runs: RunWithSummary[] }>("/api/benchmarks");
  done(ctx, runs, () =>
    runs.length
      ? formatTable(
          ["Run", "Status", "Created", "Models"],
          runs.map((run) => [
            run.id,
            run.status,
            run.createdAt.slice(0, 16).replace("T", " "),
            run.summary
              .map((s) => `${benchmarkTargetKey(s.target)} ${s.passed}/${s.total}`)
              .join(", "),
          ]),
        )
      : "No benchmark runs yet. Start one with `locus eval run --model provider/model`.",
  );
}

export async function cmdEvalShow(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "run id");
  const run = await ctx.client.get<RunWithSummary>(`/api/benchmarks/${encodeURIComponent(id)}`);
  done(ctx, run, () => runDetail(run));
}

export async function cmdEvalCancel(ctx: Ctx): Promise<void> {
  const id = need(ctx.args, 0, "run id");
  const run = await ctx.client.post<RunWithSummary>(
    `/api/benchmarks/${encodeURIComponent(id)}/cancel`,
  );
  done(ctx, run, () => `Cancelling ${run.id}.`);
}
