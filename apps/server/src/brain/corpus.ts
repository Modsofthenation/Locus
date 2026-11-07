import {
  brainJiraCorpusEnabled,
  brainSlackCorpusEnabled,
  type BrainCorpusRow,
  type LocusConfig,
} from "@locus/shared";
import { IntegrationsClient } from "../integrations/integrations.js";
import type { JsonStore } from "../core/store.js";
import type { SlackGateway } from "../slack/slackGateway.js";

export function slackCorpusCollector(
  store: JsonStore,
  slack: SlackGateway,
): () => Promise<BrainCorpusRow[]> {
  return async () => {
    const settings = (await store.loadConfig()).brain;
    if (!brainSlackCorpusEnabled(settings)) return [];
    return slack.corpusRows();
  };
}

export function jiraCorpusCollector(
  store: JsonStore,
  fetchFn: typeof fetch = fetch,
): () => Promise<BrainCorpusRow[]> {
  return async () => {
    const config = await store.loadConfig();
    if (!brainJiraCorpusEnabled(config.brain)) return [];
    return collectJiraCorpus(config, fetchFn);
  };
}

export async function collectJiraCorpus(
  config: LocusConfig,
  fetchFn: typeof fetch = fetch,
): Promise<BrainCorpusRow[]> {
  const client = new IntegrationsClient(fetchFn);
  const result = await client.call(
    "jira_search",
    { jql: "updated >= -14d ORDER BY updated DESC" },
    config.integrations,
  );
  if (!result.ok) return [];
  return parseJiraCorpus(result.output);
}

export function parseJiraCorpus(output: string, at = new Date().toISOString()): BrainCorpusRow[] {
  const issues = extractJiraIssues(output);
  return issues.slice(0, 40).map((row) => ({
    id: `jira:${row.key}`,
    text: `${row.key}: ${row.summary}`.slice(0, 800),
    source: `jira:${row.key}`,
    createdAt: at,
  }));
}

function extractJiraIssues(output: string): Array<{ key: string; summary: string }> {
  try {
    const parsed = JSON.parse(output) as {
      issues?: Array<{ key?: string; fields?: { summary?: string } }>;
    };
    if (!Array.isArray(parsed.issues)) return [];
    return parsed.issues
      .map((row) => ({
        key: typeof row.key === "string" ? row.key : "",
        summary: typeof row.fields?.summary === "string" ? row.fields.summary : "",
      }))
      .filter((row) => row.key);
  } catch {
    return [];
  }
}
