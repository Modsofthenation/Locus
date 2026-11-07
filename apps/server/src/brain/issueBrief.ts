import {
  formatBrainIssueBrief,
  integrationHasToken,
  issueFieldsFromToolOutput,
  parseBrainBriefIssue,
  type BrainBriefTarget,
  type BrainDocument,
  type IntegrationAccount,
} from "@locus/shared";

type IssueClient = {
  call: (
    name: "jira_get" | "linear_get" | "jira_comment" | "linear_comment",
    args: Record<string, unknown>,
    rows: IntegrationAccount[] | undefined,
  ) => Promise<{ ok: boolean; output: string }>;
};

export type BrainIssueDraft = {
  ok: true;
  issue: string;
  target: BrainBriefTarget;
  title?: string;
  body: string;
};

export function resolveBrainBriefTarget(
  parsed: { issue: string; target?: BrainBriefTarget },
  explicit: string | undefined,
  rows: IntegrationAccount[] | undefined,
): BrainBriefTarget | undefined {
  const wanted = explicit?.trim().toLowerCase();
  if (wanted === "jira" || wanted === "linear") return wanted;
  if (parsed.target) return parsed.target;
  const jira = (rows ?? []).some((row) => row.kind === "jira" && integrationHasToken(row));
  const linear = (rows ?? []).some((row) => row.kind === "linear" && integrationHasToken(row));
  if (linear && !jira) return "linear";
  if (jira && !linear) return "jira";
  if (jira) return "jira";
  return undefined;
}

export async function draftBrainIssueBrief(input: {
  doc: BrainDocument;
  issue: string;
  target?: string;
  title?: string;
  summary?: string;
  body?: string;
  integrations?: IntegrationAccount[];
  client?: IssueClient;
}): Promise<BrainIssueDraft | { ok: false; output: string }> {
  const parsed = parseBrainBriefIssue(input.issue);
  if (!parsed.issue.trim()) return { ok: false, output: "issue is required" };
  const target = resolveBrainBriefTarget(parsed, input.target, input.integrations);
  if (!target) {
    return { ok: false, output: "Pass target jira or linear." };
  }
  let title = input.title?.trim() || undefined;
  let summary = input.summary?.trim() || undefined;
  if (input.client && !title && !summary) {
    try {
      const got = await input.client.call(
        target === "linear" ? "linear_get" : "jira_get",
        { issue: parsed.issue },
        input.integrations,
      );
      if (got.ok) {
        const fields = issueFieldsFromToolOutput(got.output);
        title = title || fields.title;
        summary = summary || fields.summary;
      }
    } catch {
      /* A missing ticket still gets a brain-only draft. */
    }
  }
  const body =
    input.body?.trim() ||
    formatBrainIssueBrief({
      issue: parsed.issue,
      title,
      summary,
      doc: input.doc,
    });
  return { ok: true, issue: parsed.issue, target, title, body };
}

export async function postBrainIssueBrief(
  client: IssueClient,
  draft: BrainIssueDraft,
  rows: IntegrationAccount[] | undefined,
): Promise<{ ok: boolean; output: string }> {
  return client.call(
    draft.target === "linear" ? "linear_comment" : "jira_comment",
    {
      issue: draft.issue,
      body: draft.body,
    },
    rows,
  );
}
