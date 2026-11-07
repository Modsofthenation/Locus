import {
  encodeIntegrationJson,
  figmaApiNodeId,
  importMiroItems,
  integrationHasToken,
  integrationKindForTool,
  isGoogleIntegrationKind,
  locusConnectorToMiroBody,
  locusObjectToMiroCreate,
  parseBoardObject,
  parseFigmaFileRef,
  parseFigmaTeamRef,
  parseSlackPostAs,
  slackChannelAllowed,
  slackWriteToken,
  summarizeFigmaDocument,
  SLACK_UPLOAD_MAX_BYTES,
  type BoardObject,
  type IntegrationAccount,
  type IntegrationKind,
  type IntegrationToolName,
} from "@locus/shared";
import { SlackApi } from "../slack/slackApi.js";
import { callGoogleTool, type PersistIntegration } from "./google.js";
import { queryGrafanaLogs } from "./grafanaQuery.js";
import { callKubernetes } from "./kubernetes.js";
import { callAwsIam } from "./awsIam.js";
import { callLinear } from "./linear.js";

export type IntegrationFetcher = typeof fetch;

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

export const JIRA_CLOUD_TOKEN_HINT =
  "Jira Cloud token must be email:api-token. A raw API token is sent as Bearer and Atlassian rejects it (Failed to parse Connect Session Auth Token). Use a classic token without scopes as you@site.com:<token> against https://your-site.atlassian.net. Scoped tokens (read:jira-work) need Base URL https://api.atlassian.com/ex/jira/{cloudId}.";

export const CONFLUENCE_CLOUD_TOKEN_HINT =
  "Confluence Cloud token must be email:api-token. A raw API token is sent as Bearer and Atlassian rejects it (Failed to parse Connect Session Auth Token). Use a classic token without scopes as you@site.com:<token> against https://your-site.atlassian.net. Scoped tokens (read:confluence-content.all / write:confluence-content) need Base URL https://api.atlassian.com/ex/confluence/{cloudId}.";

export const JIRA_HEADER_TOO_LARGE_HINT =
  "HTTP 494/400 here is request headers too large (nginx logs 494, clients often see 400 Bad Request). Locus only sends Authorization and Accept — a JWT, session cookie, or pasted blob in the token field will trip Akamai EAA (~4KB) or nginx. Use a classic API token as you@site.com:<token>, not an OAuth access token or cookie.";

function atlassianCloudSiteHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "atlassian.net" || host.endsWith(".atlassian.net");
  } catch {
    return /\.atlassian\.net(?:[:/]|$)/i.test(baseUrl);
  }
}

function isAtlassianKind(kind: IntegrationKind): boolean {
  return kind === "jira" || kind === "confluence";
}

function atlassianCloudTokenHint(kind: IntegrationKind): string {
  return kind === "confluence" ? CONFLUENCE_CLOUD_TOKEN_HINT : JIRA_CLOUD_TOKEN_HINT;
}

function authHeaders(account: IntegrationAccount): Record<string, string> {
  const token = account.token?.trim() ?? "";
  if (isAtlassianKind(account.kind) && token.length > 2_000) {
    throw new Error(JIRA_HEADER_TOO_LARGE_HINT);
  }
  if (isAtlassianKind(account.kind) && token.includes(":")) {
    return {
      Authorization: `Basic ${Buffer.from(token).toString("base64")}`,
      Accept: "application/json",
    };
  }
  if (isAtlassianKind(account.kind) && atlassianCloudSiteHost(account.baseUrl)) {
    throw new Error(atlassianCloudTokenHint(account.kind));
  }
  if (account.kind === "figma") {
    return { "X-Figma-Token": token, Accept: "application/json" };
  }
  if (account.kind === "portainer") {
    if (looksLikeJwt(token)) {
      return { Authorization: `Bearer ${token}`, Accept: "application/json" };
    }
    return { "X-API-Key": token, Accept: "application/json" };
  }
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

function integrationHttpError(account: IntegrationAccount, text: string, status: number): Error {
  const snippet = text.slice(0, 400).trim() || `HTTP ${status}`;
  if (account.kind === "figma") {
    try {
      const parsed = JSON.parse(text) as { err?: string; message?: string };
      const err = (parsed.err || parsed.message || "").trim();
      if (err) return new Error(`HTTP ${status}: ${err}`);
    } catch {
      /* use snippet */
    }
    return new Error(snippet);
  }
  if (!isAtlassianKind(account.kind)) return new Error(text.slice(0, 400) || `HTTP ${status}`);
  if (/Failed to parse Connect Session Auth Token/i.test(snippet)) {
    return new Error(atlassianCloudTokenHint(account.kind));
  }
  if (
    status === 494 ||
    status === 431 ||
    /request header is too large/i.test(snippet) ||
    /\b494\b/.test(snippet)
  ) {
    return new Error(JIRA_HEADER_TOO_LARGE_HINT);
  }
  if (
    account.kind === "jira" &&
    status === 400 &&
    /does not exist for the field ['"]?project/i.test(snippet)
  ) {
    return new Error(
      `HTTP 400: ${snippet}\nJira returns 400 for project JQL when the call is anonymous. Use email:api-token (classic token, no scopes) against https://your-site.atlassian.net.`,
    );
  }
  return new Error(`HTTP ${status}: ${snippet}`);
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

export class IntegrationsClient {
  private readonly slackApi: SlackApi;

  constructor(
    private readonly fetchFn: IntegrationFetcher = fetch,
    private readonly persistAccount?: PersistIntegration,
  ) {
    this.slackApi = new SlackApi(fetchFn);
  }

  account(
    rows: IntegrationAccount[] | undefined,
    kind: IntegrationKind,
  ): IntegrationAccount | undefined {
    return (rows ?? []).find((row) => row.kind === kind && integrationHasToken(row));
  }

  async call(
    name: IntegrationToolName,
    args: Record<string, unknown>,
    rows: IntegrationAccount[] | undefined,
  ): Promise<{ ok: boolean; output: string }> {
    try {
      if (name.startsWith("jira_")) return await this.jira(name, args, this.require(rows, "jira"));
      if (name.startsWith("confluence_"))
        return await this.confluence(name, args, this.require(rows, "confluence"));
      if (name.startsWith("linear_"))
        return await callLinear(name, args, this.require(rows, "linear"), this.fetchFn);
      if (name.startsWith("slack_"))
        return await this.slack(name, args, this.require(rows, "slack"));
      if (name.startsWith("sentry_"))
        return await this.sentry(name, args, this.require(rows, "sentry"));
      if (name.startsWith("miro_")) return await this.miro(name, args, this.require(rows, "miro"));
      if (name.startsWith("incidentio_"))
        return await this.incidentio(name, args, this.require(rows, "incidentio"));
      if (name.startsWith("aws_"))
        return await callAwsIam(name, args, this.require(rows, "aws"), this.fetchFn);
      if (name.startsWith("portainer_"))
        return await this.portainer(name, args, this.require(rows, "portainer"));
      if (name.startsWith("figma_"))
        return await this.figma(name, args, this.require(rows, "figma"));
      if (name.startsWith("gmail_") || name.startsWith("calendar_") || name.startsWith("drive_")) {
        const kind = integrationKindForTool(name);
        if (!kind || !isGoogleIntegrationKind(kind)) {
          return { ok: false, output: `Unknown Google tool ${name}` };
        }
        return await callGoogleTool(
          name,
          args,
          this.require(rows, kind),
          this.fetchFn,
          this.persistAccount,
        );
      }
      if (name.startsWith("k8s_"))
        return await callKubernetes(name, args, this.require(rows, "kubernetes"), this.fetchFn);
      return await this.grafana(name, args, this.require(rows, "grafana"));
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : "Integration failed" };
    }
  }

  private require(
    rows: IntegrationAccount[] | undefined,
    kind: IntegrationKind,
  ): IntegrationAccount {
    const account = this.account(rows, kind);
    if (!account) {
      const label = isGoogleIntegrationKind(kind)
        ? kind === "gmail"
          ? "Gmail"
          : kind === "gcal"
            ? "Google Calendar"
            : "Google Drive"
        : kind;
      throw new Error(`Add a ${label} token in Settings → Integrations`);
    }
    return account;
  }

  private async jira(
    name: string,
    args: Record<string, unknown>,
    account: IntegrationAccount,
  ): Promise<{ ok: boolean; output: string }> {
    if (name === "jira_search") {
      const jql = str(args, "jql") || str(args, "query");
      if (!jql) return { ok: false, output: "jql is required" };
      const url = new URL(joinUrl(account.baseUrl, "/rest/api/3/search/jql"));
      url.searchParams.set("jql", jql);
      url.searchParams.set("maxResults", "20");
      const body = await this.getJson(url, account);
      return { ok: true, output: encodeIntegrationJson(body) };
    }
    if (name === "jira_create") {
      const project = str(args, "project");
      const summary = str(args, "summary") || str(args, "title");
      if (!project || !summary) return { ok: false, output: "project and summary are required" };
      const issuetype = str(args, "issuetype") || str(args, "issue_type") || "Task";
      const description = str(args, "description") || str(args, "body");
      const parent = jiraParentKey(args);
      const extra = jiraExtraFields(args);
      const parentFields = parent ? await this.jiraParentFields(account, parent) : {};
      const created = (await this.sendJson(joinUrl(account.baseUrl, "/rest/api/3/issue"), account, {
        fields: {
          project: jiraIdOrKey(project),
          summary,
          issuetype: jiraIdOrName(issuetype),
          ...(description ? { description: jiraAdf(description) } : {}),
          ...parentFields,
          ...extra,
        },
      })) as { key?: string };
      return {
        ok: true,
        output: created.key ? `Created ${created.key}` : encodeIntegrationJson(created),
      };
    }
    if (name === "jira_update") {
      return await this.jiraUpdate(args, account);
    }
    const key = str(args, "issue") || str(args, "key");
    if (!key) return { ok: false, output: "issue key is required" };
    if (name === "jira_get") {
      const body = await this.getJson(
        joinUrl(account.baseUrl, `/rest/api/3/issue/${encodeURIComponent(key)}`),
        account,
      );
      return { ok: true, output: encodeIntegrationJson(body) };
    }
    if (name === "jira_transition") {
      const wanted = str(args, "transition") || str(args, "status") || str(args, "name");
      if (!wanted) return { ok: false, output: "transition is required" };
      const id = await this.resolveJiraTransition(account, key, wanted);
      if (!id) return { ok: false, output: `Unknown transition ${wanted}` };
      await this.sendJson(
        joinUrl(account.baseUrl, `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`),
        account,
        { transition: { id } },
      );
      return { ok: true, output: `Transitioned ${key} via ${wanted}` };
    }
    const body = str(args, "body") || str(args, "comment");
    if (!body) return { ok: false, output: "body is required" };
    await this.sendJson(
      joinUrl(account.baseUrl, `/rest/api/3/issue/${encodeURIComponent(key)}/comment`),
      account,
      { body: jiraAdf(body) },
    );
    return { ok: true, output: `Commented on ${key}` };
  }

  private async jiraUpdate(
    args: Record<string, unknown>,
    account: IntegrationAccount,
  ): Promise<{ ok: boolean; output: string }> {
    const keys = jiraIssueKeys(args);
    if (!keys.length) return { ok: false, output: "issue key is required" };
    const parent = jiraParentKey(args);
    const summary = str(args, "summary") || str(args, "title");
    const description = str(args, "description") || str(args, "body");
    const labels = jiraLabels(args);
    const extra = jiraExtraFields(args);
    const fields: Record<string, unknown> = { ...extra };
    if (summary) fields.summary = summary;
    if (description) fields.description = jiraAdf(description);
    if (labels) fields.labels = labels;
    if (parent) Object.assign(fields, await this.jiraParentFields(account, parent));
    if (!Object.keys(fields).length) {
      return {
        ok: false,
        output: "parent, summary, description, labels, or fields are required",
      };
    }
    const updated: string[] = [];
    const failed: string[] = [];
    for (const key of keys) {
      try {
        await this.putJiraFields(account, key, { ...fields });
        updated.push(key);
      } catch (err) {
        failed.push(`${key}: ${err instanceof Error ? err.message : "update failed"}`);
      }
    }
    if (!updated.length) return { ok: false, output: failed.join("\n") || "Update failed" };
    const lines = [`Updated ${updated.join(", ")}`];
    if (parent) lines.push(`parent ${parent}`);
    if (failed.length) lines.push(`Failed: ${failed.join("; ")}`);
    return { ok: failed.length === 0, output: lines.join(". ") };
  }

  private async jiraParentFields(
    account: IntegrationAccount,
    parentKey: string,
  ): Promise<Record<string, unknown>> {
    const fields: Record<string, unknown> = { parent: jiraIdOrKey(parentKey) };
    const epicField = await this.jiraEpicLinkFieldId(account);
    if (epicField) fields[epicField] = parentKey;
    return fields;
  }

  private async jiraEpicLinkFieldId(account: IntegrationAccount): Promise<string | undefined> {
    try {
      const listed = (await this.getJson(
        joinUrl(account.baseUrl, "/rest/api/3/field"),
        account,
      )) as Array<{
        id?: string;
        key?: string;
        name?: string;
        schema?: { custom?: string; system?: string };
      }>;
      const match = (Array.isArray(listed) ? listed : []).find((row) => {
        const custom = row.schema?.custom ?? "";
        const name = (row.name ?? "").trim().toLowerCase();
        return (
          custom === "com.pyxis.greenhopper.jira:gh-epic-link" ||
          name === "epic link" ||
          name === "epic-link"
        );
      });
      const id = match?.id?.trim() || match?.key?.trim();
      return id && id !== "parent" ? id : undefined;
    } catch {
      return undefined;
    }
  }

  private async putJiraFields(
    account: IntegrationAccount,
    key: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    const url = joinUrl(account.baseUrl, `/rest/api/3/issue/${encodeURIComponent(key)}`);
    const current = { ...fields };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.sendJson(url, account, { fields: current }, "PUT");
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        const drop = jiraUnsettableFields(message).filter((name) => name in current);
        if (!drop.length || Object.keys(current).length <= drop.length) throw err;
        for (const name of drop) delete current[name];
      }
    }
  }

  private async resolveJiraTransition(
    account: IntegrationAccount,
    key: string,
    wanted: string,
  ): Promise<string | undefined> {
    const listed = (await this.getJson(
      joinUrl(account.baseUrl, `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`),
      account,
    )) as { transitions?: Array<{ id?: string; name?: string }> };
    const rows = listed.transitions ?? [];
    const needle = wanted.toLowerCase();
    const match = rows.find(
      (row) => row.id === wanted || (row.name ?? "").trim().toLowerCase() === needle,
    );
    if (match?.id) return match.id;
    return undefined;
  }

  private async confluence(
    name: string,
    args: Record<string, unknown>,
    account: IntegrationAccount,
  ): Promise<{ ok: boolean; output: string }> {
    const wiki = confluenceWikiRoot(account);
    if (name === "confluence_search") {
      const raw = str(args, "cql") || str(args, "query");
      if (!raw) return { ok: false, output: "cql is required" };
      const url = new URL(joinUrl(wiki, "/rest/api/content/search"));
      url.searchParams.set("cql", confluenceCql(raw));
      url.searchParams.set("limit", "20");
      url.searchParams.set("expand", "space,version");
      const body = await this.getJson(url, account);
      return { ok: true, output: encodeIntegrationJson(compactConfluenceSearch(body)) };
    }
    if (name === "confluence_create") {
      const space = str(args, "space") || str(args, "spaceKey");
      const title = str(args, "title");
      if (!space || !title) return { ok: false, output: "space and title are required" };
      const body = str(args, "body") || str(args, "content") || str(args, "html");
      const parent = str(args, "parent") || str(args, "parentId");
      const created = (await this.sendJson(joinUrl(wiki, "/rest/api/content"), account, {
        type: "page",
        title,
        space: { key: space },
        ...(parent ? { ancestors: [{ id: parent }] } : {}),
        ...(body
          ? { body: { storage: { value: confluenceStorage(body), representation: "storage" } } }
          : {}),
      })) as { id?: string; title?: string };
      const id = typeof created.id === "string" ? created.id : "";
      return {
        ok: true,
        output: id
          ? `Created page ${id}${created.title ? ` "${created.title}"` : ""}`
          : encodeIntegrationJson(created),
      };
    }
    const page = await this.resolveConfluencePage(wiki, account, args);
    if (!page.ok) return page;
    if (name === "confluence_get") {
      return { ok: true, output: encodeIntegrationJson(compactConfluencePage(page.page, true)) };
    }
    if (name === "confluence_update") {
      return await this.confluenceUpdate(wiki, account, page.page, args);
    }
    const body = str(args, "body") || str(args, "comment");
    if (!body) return { ok: false, output: "body is required" };
    const id = confluencePageId(page.page);
    if (!id) return { ok: false, output: "page id is required" };
    await this.sendJson(
      joinUrl(wiki, `/rest/api/content/${encodeURIComponent(id)}/child/comment`),
      account,
      {
        type: "comment",
        container: { type: "page", id },
        body: { storage: { value: confluenceStorage(body), representation: "storage" } },
      },
    );
    return { ok: true, output: `Commented on page ${id}` };
  }

  private async resolveConfluencePage(
    wiki: string,
    account: IntegrationAccount,
    args: Record<string, unknown>,
  ): Promise<{ ok: true; page: Record<string, unknown> } | { ok: false; output: string }> {
    const id =
      str(args, "id") || str(args, "page") || str(args, "pageId") || str(args, "contentId");
    if (id) {
      const page = (await this.getJson(
        joinUrl(
          wiki,
          `/rest/api/content/${encodeURIComponent(id)}?expand=body.storage,version,space,ancestors`,
        ),
        account,
      )) as Record<string, unknown>;
      return { ok: true, page };
    }
    const title = str(args, "title");
    const space = str(args, "space") || str(args, "spaceKey");
    if (!title || !space) return { ok: false, output: "page id, or title and space, are required" };
    const url = new URL(joinUrl(wiki, "/rest/api/content"));
    url.searchParams.set("title", title);
    url.searchParams.set("spaceKey", space);
    url.searchParams.set("expand", "body.storage,version,space,ancestors");
    const listed = (await this.getJson(url, account)) as { results?: unknown[] };
    const results = Array.isArray(listed.results) ? listed.results : [];
    if (!results.length)
      return { ok: false, output: `No Confluence page titled ${title} in space ${space}` };
    const first = results[0];
    if (!first || typeof first !== "object")
      return { ok: false, output: "Confluence page lookup failed" };
    return { ok: true, page: first as Record<string, unknown> };
  }

  private async confluenceUpdate(
    wiki: string,
    account: IntegrationAccount,
    current: Record<string, unknown>,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; output: string }> {
    const id = confluencePageId(current);
    if (!id) return { ok: false, output: "page id is required" };
    const title = str(args, "title") || (typeof current.title === "string" ? current.title : "");
    const body = str(args, "body") || str(args, "content") || str(args, "html");
    const currentBody =
      typeof (current.body as { storage?: { value?: string } } | undefined)?.storage?.value ===
      "string"
        ? (current.body as { storage: { value: string } }).storage.value
        : "";
    if (!title && !body) return { ok: false, output: "title or body is required" };
    const version = current.version as { number?: number } | undefined;
    const nextVersion = (typeof version?.number === "number" ? version.number : 1) + 1;
    const spaceKey =
      typeof (current.space as { key?: string } | undefined)?.key === "string"
        ? (current.space as { key: string }).key
        : str(args, "space") || str(args, "spaceKey");
    const updated = (await this.sendJson(
      joinUrl(wiki, `/rest/api/content/${encodeURIComponent(id)}`),
      account,
      {
        id,
        type: typeof current.type === "string" ? current.type : "page",
        title: title || "Untitled",
        ...(spaceKey ? { space: { key: spaceKey } } : {}),
        version: { number: nextVersion },
        body: {
          storage: {
            value: confluenceStorage(body || currentBody || "<p></p>"),
            representation: "storage",
          },
        },
      },
      "PUT",
    )) as { id?: string; title?: string; version?: { number?: number } };
    const ver = updated.version?.number ?? nextVersion;
    return {
      ok: true,
      output: `Updated page ${id}${updated.title ? ` "${updated.title}"` : ""} (version ${ver})`,
    };
  }

  private async slack(
    name: string,
    args: Record<string, unknown>,
    account: IntegrationAccount,
  ): Promise<{ ok: boolean; output: string }> {
    const as = parseSlackPostAs(args.as);
    const write = name === "slack_post" || name === "slack_upload";
    const token = slackWriteToken(account, write ? as : "user");
    if (!token) {
      return {
        ok: false,
        output:
          write && as === "bot"
            ? "No Slack bot token. Re-sign in with Slack after adding bot chat:write, or paste an xoxb- token in Settings → Integrations."
            : "Sign in with Slack in Settings → Integrations",
      };
    }
    const asUser = {
      ...account,
      userToken: account.userToken || (token.startsWith("xoxp-") ? token : account.userToken),
    };
    try {
      if (name === "slack_channels") {
        const rows = await this.slackApi.listConversations(
          asUser.userToken ? asUser : { ...account, token },
        );
        const allowed = rows.filter((row) => slackChannelAllowed(account, row.id));
        const lines = allowed.map(
          (row) => `${row.kind === "im" || row.kind === "mpim" ? "@" : "#"}${row.name} ${row.id}`,
        );
        return { ok: true, output: lines.join("\n") || "No channels" };
      }
      if (name === "slack_history") {
        const channel = str(args, "channel");
        if (!channel) return { ok: false, output: "channel is required" };
        if (!slackChannelAllowed(account, channel)) {
          return { ok: false, output: "This channel is not on the Slack allowlist" };
        }
        const limit = typeof args.limit === "number" ? args.limit : 40;
        const rows = await this.slackApi.history(
          asUser.userToken ? asUser : { ...account, token },
          channel,
          {
            limit,
          },
        );
        const lines = rows.map(
          (row) => `${row.ts} ${row.userName || row.userId || "?"}: ${row.text}`,
        );
        return { ok: true, output: lines.join("\n") || "No messages" };
      }
      if (name === "slack_replies") {
        const channel = str(args, "channel");
        const ts = str(args, "thread_ts") || str(args, "ts");
        if (!channel || !ts) return { ok: false, output: "channel and thread_ts are required" };
        if (!slackChannelAllowed(account, channel)) {
          return { ok: false, output: "This channel is not on the Slack allowlist" };
        }
        const rows = await this.slackApi.replies(
          asUser.userToken ? asUser : { ...account, token },
          channel,
          ts,
        );
        const lines = rows.map(
          (row) => `${row.ts} ${row.userName || row.userId || "?"}: ${row.text}`,
        );
        return { ok: true, output: lines.join("\n") || "No replies" };
      }
      const channel = str(args, "channel");
      if (!channel) return { ok: false, output: "channel is required" };
      if (!slackChannelAllowed(account, channel)) {
        return { ok: false, output: "This channel is not on the Slack allowlist" };
      }
      if (name === "slack_upload") {
        const filename = str(args, "filename") || str(args, "name") || "upload";
        const bytes = decodeSlackUploadBytes(args);
        if (!bytes) return { ok: false, output: "content or bytes_base64 is required" };
        const posted = await this.slackApi.uploadFile(account, {
          channel,
          filename,
          bytes,
          mime: str(args, "mime") || str(args, "mimetype") || undefined,
          comment: str(args, "comment") || str(args, "text") || str(args, "body") || undefined,
          threadTs: str(args, "thread_ts"),
          as,
        });
        return { ok: true, output: `Uploaded ${filename} to ${channel} ts=${posted.ts}` };
      }
      const text = str(args, "text") || str(args, "body");
      if (!text) return { ok: false, output: "channel and text are required" };
      const posted = await this.slackApi.postMessage(account, {
        channel,
        text,
        threadTs: str(args, "thread_ts"),
        as,
      });
      return { ok: true, output: `Posted to ${channel} ts=${posted.ts}` };
    } catch (err) {
      return { ok: false, output: err instanceof Error ? err.message : "Slack error" };
    }
  }

  private async incidentio(
    name: string,
    args: Record<string, unknown>,
    account: IntegrationAccount,
  ): Promise<{ ok: boolean; output: string }> {
    if (name === "incidentio_search") return this.incidentioSearch(args, account);
    if (name === "incidentio_create") return this.incidentioCreate(args, account);
    const id = incidentioIncidentId(args);
    if (!id) return { ok: false, output: "incident id is required" };
    const resolved = await this.incidentioResolveId(account, id);
    if (name === "incidentio_get") {
      const body = await this.getJson(
        joinUrl(account.baseUrl, `/v2/incidents/${encodeURIComponent(resolved)}`),
        account,
      );
      return { ok: true, output: encodeIntegrationJson(body) };
    }
    if (name === "incidentio_update") return this.incidentioUpdate(args, account, resolved);
    const message = str(args, "body") || str(args, "message") || str(args, "comment");
    const statusId = await this.incidentioCatalogId(account, "status", str(args, "status"));
    const severityId = await this.incidentioCatalogId(account, "severity", str(args, "severity"));
    if (!message && !statusId && !severityId) {
      return { ok: false, output: "body, status, or severity is required" };
    }
    const posted = (await this.sendJson(joinUrl(account.baseUrl, "/v2/incident_updates"), account, {
      incident_id: resolved,
      idempotency_key: crypto.randomUUID(),
      ...(message ? { message } : {}),
      ...(statusId ? { to_incident_status_id: statusId } : {}),
      ...(severityId ? { to_severity_id: severityId } : {}),
    })) as { incident_update?: { id?: string }; incident?: { reference?: string; id?: string } };
    const ref = incidentioRef(posted.incident) || id;
    return { ok: true, output: `Posted update on ${ref}` };
  }

  private async incidentioSearch(
    args: Record<string, unknown>,
    account: IntegrationAccount,
  ): Promise<{ ok: boolean; output: string }> {
    const url = new URL(joinUrl(account.baseUrl, "/v2/incidents"));
    const pageSize = incidentioPageSize(args.page_size);
    url.searchParams.set("page_size", String(pageSize));
    const after = str(args, "after");
    if (after) url.searchParams.set("after", after);
    const category = incidentioStatusCategory(
      str(args, "status_category") || str(args, "category"),
    );
    if (category) url.searchParams.append("status_category[one_of]", category);
    const statusId = await this.incidentioCatalogId(account, "status", str(args, "status"));
    if (statusId) url.searchParams.append("status[one_of]", statusId);
    const severityId = await this.incidentioCatalogId(account, "severity", str(args, "severity"));
    if (severityId) url.searchParams.append("severity[one_of]", severityId);
    const body = (await this.getJson(url, account)) as {
      incidents?: unknown[];
      pagination_meta?: unknown;
    };
    const query = str(args, "query") || str(args, "q");
    const listed = Array.isArray(body.incidents) ? body.incidents : [];
    const incidents = query ? listed.filter((row) => incidentioMatchesQuery(row, query)) : listed;
    return {
      ok: true,
      output: encodeIntegrationJson({
        incidents: incidents.map(incidentioSlim),
        pagination_meta: body.pagination_meta,
      }),
    };
  }

  private async incidentioCreate(
    args: Record<string, unknown>,
    account: IntegrationAccount,
  ): Promise<{ ok: boolean; output: string }> {
    const name = str(args, "name") || str(args, "title");
    if (!name) return { ok: false, output: "name is required" };
    const summary = str(args, "summary") || str(args, "description") || str(args, "body");
    const visibility = str(args, "visibility").toLowerCase() === "private" ? "private" : "public";
    const mode = incidentioMode(str(args, "mode"));
    const statusId = await this.incidentioCatalogId(account, "status", str(args, "status"));
    const severityId = await this.incidentioCatalogId(account, "severity", str(args, "severity"));
    const created = (await this.sendJson(joinUrl(account.baseUrl, "/v2/incidents"), account, {
      name,
      visibility,
      idempotency_key: str(args, "idempotency_key") || crypto.randomUUID(),
      ...(summary ? { summary } : {}),
      ...(mode ? { mode } : {}),
      ...(statusId ? { incident_status_id: statusId } : {}),
      ...(severityId ? { severity_id: severityId } : {}),
    })) as { incident?: { id?: string; reference?: string; name?: string } };
    const incident = created.incident;
    const ref = incidentioRef(incident) || name;
    return {
      ok: true,
      output: incident?.id ? `Created ${ref} id=${incident.id}` : encodeIntegrationJson(created),
    };
  }

  private async incidentioUpdate(
    args: Record<string, unknown>,
    account: IntegrationAccount,
    id: string,
  ): Promise<{ ok: boolean; output: string }> {
    const incident: Record<string, unknown> = {};
    const name = str(args, "name") || str(args, "title");
    const summary = str(args, "summary") || str(args, "description");
    if (name) incident.name = name;
    if (summary) incident.summary = summary;
    const statusId = await this.incidentioCatalogId(account, "status", str(args, "status"));
    const severityId = await this.incidentioCatalogId(account, "severity", str(args, "severity"));
    if (statusId) incident.incident_status_id = statusId;
    if (severityId) incident.severity_id = severityId;
    if (!Object.keys(incident).length) {
      return { ok: false, output: "name, summary, status, or severity is required" };
    }
    const edited = (await this.sendJson(
      joinUrl(account.baseUrl, `/v2/incidents/${encodeURIComponent(id)}/actions/edit`),
      account,
      { incident, notify_incident_channel: args.notify === false ? false : true },
    )) as { incident?: { id?: string; reference?: string } };
    const ref = incidentioRef(edited.incident) || id;
    return { ok: true, output: `Updated ${ref}` };
  }

  private async incidentioResolveId(account: IntegrationAccount, raw: string): Promise<string> {
    if (incidentioLooksLikeId(raw)) return raw;
    const url = new URL(joinUrl(account.baseUrl, "/v2/incidents"));
    url.searchParams.set("page_size", "50");
    const body = (await this.getJson(url, account)) as { incidents?: unknown[] };
    const needle = raw.trim().toLowerCase();
    const match = (Array.isArray(body.incidents) ? body.incidents : []).find((row) => {
      const rec = incidentioRecord(row);
      const reference = typeof rec.reference === "string" ? rec.reference.trim().toLowerCase() : "";
      const id = typeof rec.id === "string" ? rec.id.trim().toLowerCase() : "";
      const name = typeof rec.name === "string" ? rec.name.trim().toLowerCase() : "";
      return reference === needle || id === needle || name === needle;
    });
    const id = match ? String(incidentioRecord(match).id ?? "").trim() : "";
    if (!id) throw new Error(`Unknown incident ${raw}`);
    return id;
  }

  private async incidentioCatalogId(
    account: IntegrationAccount,
    kind: "status" | "severity",
    wanted: string,
  ): Promise<string | undefined> {
    if (!wanted) return undefined;
    if (incidentioLooksLikeId(wanted)) return wanted;
    const path = kind === "status" ? "/v1/incident_statuses" : "/v1/severities";
    const key = kind === "status" ? "incident_statuses" : "severities";
    const body = (await this.getJson(joinUrl(account.baseUrl, path), account)) as Record<
      string,
      unknown
    >;
    const rows = Array.isArray(body[key]) ? body[key] : [];
    const needle = wanted.trim().toLowerCase();
    const match = rows.find((row) => {
      const rec = incidentioRecord(row);
      const id = typeof rec.id === "string" ? rec.id.trim() : "";
      const name = typeof rec.name === "string" ? rec.name.trim().toLowerCase() : "";
      return id === wanted || name === needle;
    });
    const id = match ? String(incidentioRecord(match).id ?? "").trim() : "";
    if (!id) throw new Error(`Unknown ${kind} ${wanted}`);
    return id;
  }

  private async portainer(
    name: string,
    args: Record<string, unknown>,
    account: IntegrationAccount,
  ): Promise<{ ok: boolean; output: string }> {
    if (name === "portainer_endpoints") {
      const rows = await this.portainerEndpointRows(account);
      const lines = rows.map(formatPortainerEndpoint);
      return { ok: true, output: lines.join("\n") || "No Portainer environments" };
    }
    if (name === "portainer_stacks") {
      return await this.portainerStacks(args, account);
    }
    if (name === "portainer_stack_action") {
      return await this.portainerStackAction(args, account);
    }
    const endpoint = await this.resolvePortainerEndpoint(account, args);
    if (!endpoint.ok) return endpoint;
    if (!isDockerPortainerEndpoint(endpoint.type)) {
      return {
        ok: false,
        output: `Environment ${endpoint.id} (${endpoint.name}) is ${portainerEndpointTypeLabel(endpoint.type)}, not Docker. Container tools only work on Docker / agent environments.`,
      };
    }
    if (name === "portainer_containers") {
      return await this.portainerContainers(args, account, endpoint.id);
    }
    const container = portainerContainerRef(args);
    if (!container) return { ok: false, output: "container is required" };
    if (name === "portainer_inspect") {
      const body = await this.getJson(
        joinUrl(
          account.baseUrl,
          `/api/endpoints/${endpoint.id}/docker/containers/${encodeURIComponent(container)}/json`,
        ),
        account,
      );
      return { ok: true, output: encodeIntegrationJson(summarizePortainerInspect(body)) };
    }
    if (name === "portainer_logs") {
      const tail = portainerTail(args);
      const url = new URL(
        joinUrl(
          account.baseUrl,
          `/api/endpoints/${endpoint.id}/docker/containers/${encodeURIComponent(container)}/logs`,
        ),
      );
      url.searchParams.set("stdout", "1");
      url.searchParams.set("stderr", "1");
      url.searchParams.set("timestamps", "1");
      url.searchParams.set("tail", String(tail));
      const text = await this.getDockerLogs(url, account);
      return { ok: true, output: text.trim() || "(no logs)" };
    }
    const action = portainerContainerAction(args);
    if (!action) return { ok: false, output: "action must be start, stop, or restart" };
    await this.postEmpty(
      joinUrl(
        account.baseUrl,
        `/api/endpoints/${endpoint.id}/docker/containers/${encodeURIComponent(container)}/${action}`,
      ),
      account,
    );
    return { ok: true, output: `${action} ${container} on endpoint ${endpoint.id}` };
  }

  private async portainerContainers(
    args: Record<string, unknown>,
    account: IntegrationAccount,
    endpointId: number,
  ): Promise<{ ok: boolean; output: string }> {
    const url = new URL(
      joinUrl(account.baseUrl, `/api/endpoints/${endpointId}/docker/containers/json`),
    );
    url.searchParams.set("all", args.all === false ? "false" : "true");
    const listed = asRecordRows(await this.getJson(url, account));
    const needle = (str(args, "name") || str(args, "filter")).toLowerCase();
    const rows = needle
      ? listed.filter((row) => formatPortainerContainer(row).toLowerCase().includes(needle))
      : listed;
    const lines = rows.map(formatPortainerContainer);
    return { ok: true, output: lines.join("\n") || "No containers" };
  }

  private async portainerStacks(
    args: Record<string, unknown>,
    account: IntegrationAccount,
  ): Promise<{ ok: boolean; output: string }> {
    const listed = asRecordRows(
      await this.getJson(joinUrl(account.baseUrl, "/api/stacks"), account),
    );
    const wanted = str(args, "stack") || str(args, "id") || str(args, "name");
    let rows = listed;
    const endpointHint = portainerEndpointHint(args);
    if (endpointHint) {
      const endpoint = await this.resolvePortainerEndpoint(account, args);
      if (!endpoint.ok) return endpoint;
      rows = rows.filter((row) => Number(row.EndpointId) === endpoint.id);
    }
    if (wanted) {
      const match = rows.find((row) => portainerStackMatches(row, wanted));
      if (!match) return { ok: false, output: `Unknown stack ${wanted}` };
      const id = Number(match.Id);
      let file = "";
      try {
        const body = (await this.getJson(
          joinUrl(account.baseUrl, `/api/stacks/${id}/file`),
          account,
        )) as { StackFileContent?: string };
        file = typeof body.StackFileContent === "string" ? body.StackFileContent : "";
      } catch {
        file = "";
      }
      return {
        ok: true,
        output: encodeIntegrationJson({
          ...summarizePortainerStack(match),
          ...(file ? { file } : {}),
        }),
      };
    }
    const lines = rows.map((row) => formatPortainerStack(row));
    return { ok: true, output: lines.join("\n") || "No stacks" };
  }

  private async portainerStackAction(
    args: Record<string, unknown>,
    account: IntegrationAccount,
  ): Promise<{ ok: boolean; output: string }> {
    const wanted = str(args, "stack") || str(args, "id") || str(args, "name");
    const action = portainerStackActionName(args);
    if (!wanted) return { ok: false, output: "stack is required" };
    if (!action) return { ok: false, output: "action must be start or stop" };
    const listed = asRecordRows(
      await this.getJson(joinUrl(account.baseUrl, "/api/stacks"), account),
    );
    const match = listed.find((row) => portainerStackMatches(row, wanted));
    if (!match) return { ok: false, output: `Unknown stack ${wanted}` };
    const stackId = Number(match.Id);
    let endpointId = Number(match.EndpointId);
    if (portainerEndpointHint(args)) {
      const endpoint = await this.resolvePortainerEndpoint(account, args);
      if (!endpoint.ok) return endpoint;
      endpointId = endpoint.id;
    }
    if (!Number.isFinite(endpointId)) {
      return { ok: false, output: "endpoint is required to start or stop a stack" };
    }
    const url = new URL(joinUrl(account.baseUrl, `/api/stacks/${stackId}/${action}`));
    url.searchParams.set("endpointId", String(endpointId));
    await this.postEmpty(url.toString(), account);
    return { ok: true, output: `${action} stack ${wanted} on endpoint ${endpointId}` };
  }

  private async portainerEndpointRows(
    account: IntegrationAccount,
  ): Promise<Record<string, unknown>[]> {
    return asRecordRows(await this.getJson(joinUrl(account.baseUrl, "/api/endpoints"), account));
  }

  private async resolvePortainerEndpoint(
    account: IntegrationAccount,
    args: Record<string, unknown>,
  ): Promise<{ ok: true; id: number; name: string; type: number } | { ok: false; output: string }> {
    const rows = await this.portainerEndpointRows(account);
    if (!rows.length) return { ok: false, output: "No Portainer environments" };
    const hint = portainerEndpointHint(args);
    if (!hint) {
      if (rows.length === 1) return portainerEndpointRef(rows[0]!);
      return {
        ok: false,
        output: `endpoint is required (${rows.map(formatPortainerEndpoint).join("; ")})`,
      };
    }
    const match = rows.find((row) => portainerEndpointMatches(row, hint));
    if (!match) return { ok: false, output: `Unknown environment ${hint}` };
    return portainerEndpointRef(match);
  }

  private async getDockerLogs(url: string | URL, account: IntegrationAccount): Promise<string> {
    const res = await this.fetchFn(url.toString(), { headers: authHeaders(account) });
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      throw integrationHttpError(account, buf.toString("utf8"), res.status);
    }
    return demuxDockerLogs(buf);
  }

  private async postEmpty(url: string, account: IntegrationAccount): Promise<unknown> {
    const res = await this.fetchFn(url, { method: "POST", headers: authHeaders(account) });
    const text = await res.text();
    if (!res.ok) throw integrationHttpError(account, text, res.status);
    if (!text.trim()) return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { text: text.slice(0, 2_000) };
    }
  }

  private async grafana(
    name: string,
    args: Record<string, unknown>,
    account: IntegrationAccount,
  ): Promise<{ ok: boolean; output: string }> {
    if (name === "grafana_get") {
      const uid = str(args, "uid") || str(args, "dashboard");
      if (!uid) return { ok: false, output: "uid is required" };
      const body = await this.getJson(
        joinUrl(account.baseUrl, `/api/dashboards/uid/${encodeURIComponent(uid)}`),
        account,
      );
      return { ok: true, output: encodeIntegrationJson(body) };
    }
    if (name === "grafana_query") {
      const body = await queryGrafanaLogs(account, args, this.fetchFn);
      return { ok: true, output: encodeIntegrationJson(body) };
    }
    const query = str(args, "query") || str(args, "q");
    const url = new URL(joinUrl(account.baseUrl, "/api/search"));
    if (query) url.searchParams.set("query", query);
    const body = await this.getJson(url, account);
    return { ok: true, output: encodeIntegrationJson(body) };
  }

  private async sentry(
    name: string,
    args: Record<string, unknown>,
    account: IntegrationAccount,
  ): Promise<{ ok: boolean; output: string }> {
    const root = sentryApiRoot(account.baseUrl);
    if (name === "sentry_projects") {
      const org = str(args, "org") || str(args, "organization");
      const orgs = org ? [{ slug: org }] : await this.sentryOrgs(root, account);
      const rows: unknown[] = [];
      for (const row of orgs) {
        const slug = sentrySlug(row);
        if (!slug) continue;
        const projects = await this.getJson(
          joinUrl(root, `/organizations/${encodeURIComponent(slug)}/projects/`),
          account,
        );
        rows.push({
          org: slug,
          projects: Array.isArray(projects) ? projects.map(compactSentryProject) : [],
        });
      }
      return { ok: true, output: encodeIntegrationJson({ organizations: rows }) };
    }
    if (name === "sentry_search") {
      const org = await this.resolveSentryOrg(root, account, args);
      const url = new URL(joinUrl(root, `/organizations/${encodeURIComponent(org)}/issues/`));
      const query = str(args, "query") || str(args, "q");
      if (query) url.searchParams.set("query", query);
      const period = str(args, "statsPeriod") || str(args, "stats_period");
      if (period) url.searchParams.set("statsPeriod", period);
      const sort = str(args, "sort");
      if (sort) url.searchParams.set("sort", sort);
      const limit = sentryLimit(args.limit, 25, 100);
      url.searchParams.set("limit", String(limit));
      const project = str(args, "project");
      if (project) {
        const id = await this.resolveSentryProjectId(root, account, org, project);
        if (id) url.searchParams.append("project", id);
      }
      const body = await this.getJson(url, account);
      const issues = Array.isArray(body) ? body.map(compactSentryIssue) : [];
      return { ok: true, output: encodeIntegrationJson({ org, query, issues }) };
    }
    const issueArg =
      str(args, "issue") || str(args, "issue_id") || str(args, "key") || str(args, "shortId");
    if (!issueArg) return { ok: false, output: "issue id is required" };
    const resolved = await this.resolveSentryIssue(root, account, args, issueArg);
    if (name === "sentry_update") {
      const status = str(args, "status");
      const assignedTo = str(args, "assignedTo") || str(args, "assignee");
      if (!status && !assignedTo) {
        return { ok: false, output: "status or assignedTo is required" };
      }
      const payload: Record<string, unknown> = {};
      if (status) payload.status = status;
      if (assignedTo) payload.assignedTo = assignedTo;
      const updated = (await this.sendJson(
        joinUrl(root, `/issues/${encodeURIComponent(resolved.id)}/`),
        account,
        payload,
        "PUT",
      )) as { status?: string; assignedTo?: { name?: string } };
      const bits = [`Updated ${resolved.shortId || resolved.id}`];
      if (status) bits.push(`status ${updated.status ?? status}`);
      if (assignedTo) bits.push(`assignedTo ${assignedTo}`);
      return { ok: true, output: bits.join(". ") };
    }
    const issue = compactSentryIssue(
      await this.getJson(joinUrl(root, `/issues/${encodeURIComponent(resolved.id)}/`), account),
    );
    if (name === "sentry_get") {
      const includeLatest = args.latest !== false;
      if (!includeLatest) return { ok: true, output: encodeIntegrationJson({ issue }) };
      try {
        const event = compactSentryEvent(
          await this.getJson(
            joinUrl(root, `/issues/${encodeURIComponent(resolved.id)}/events/latest/`),
            account,
          ),
        );
        return { ok: true, output: encodeIntegrationJson({ issue, latestEvent: event }) };
      } catch {
        return { ok: true, output: encodeIntegrationJson({ issue }) };
      }
    }
    const eventId = str(args, "event") || str(args, "event_id");
    const latest =
      args.latest === true || (!eventId && args.latest !== false && !("limit" in args));
    if (eventId) {
      const event = compactSentryEvent(
        await this.getJson(
          joinUrl(
            root,
            `/issues/${encodeURIComponent(resolved.id)}/events/${encodeURIComponent(eventId)}/`,
          ),
          account,
        ),
      );
      return { ok: true, output: encodeIntegrationJson({ issue: resolved, event }) };
    }
    if (latest) {
      const event = compactSentryEvent(
        await this.getJson(
          joinUrl(root, `/issues/${encodeURIComponent(resolved.id)}/events/latest/`),
          account,
        ),
      );
      return { ok: true, output: encodeIntegrationJson({ issue: resolved, event }) };
    }
    const limit = sentryLimit(args.limit, 10, 50);
    const url = new URL(joinUrl(root, `/issues/${encodeURIComponent(resolved.id)}/events/`));
    url.searchParams.set("limit", String(limit));
    const body = await this.getJson(url, account);
    const events = Array.isArray(body) ? body.map(compactSentryEvent) : [];
    return { ok: true, output: encodeIntegrationJson({ issue: resolved, events }) };
  }

  private async sentryOrgs(root: string, account: IntegrationAccount): Promise<unknown[]> {
    const body = await this.getJson(joinUrl(root, "/organizations/"), account);
    return Array.isArray(body) ? body : [];
  }

  private async resolveSentryOrg(
    root: string,
    account: IntegrationAccount,
    args: Record<string, unknown>,
  ): Promise<string> {
    const hinted = str(args, "org") || str(args, "organization");
    if (hinted) return hinted;
    const orgs = await this.sentryOrgs(root, account);
    const slugs = orgs.map(sentrySlug).filter(Boolean);
    if (slugs.length === 1) return slugs[0]!;
    if (!slugs.length) throw new Error("No Sentry organizations for this token");
    throw new Error(`Pass org (one of ${slugs.join(", ")})`);
  }

  private async resolveSentryProjectId(
    root: string,
    account: IntegrationAccount,
    org: string,
    project: string,
  ): Promise<string | undefined> {
    if (/^\d+$/.test(project)) return project;
    const listed = await this.getJson(
      joinUrl(root, `/organizations/${encodeURIComponent(org)}/projects/`),
      account,
    );
    const match = (Array.isArray(listed) ? listed : []).find((row) => {
      const rec = asRecord(row);
      return sentrySlug(row) === project || String(rec.name ?? "") === project;
    });
    const id = match ? String(asRecord(match).id ?? "").trim() : "";
    return id || undefined;
  }

  private async resolveSentryIssue(
    root: string,
    account: IntegrationAccount,
    args: Record<string, unknown>,
    raw: string,
  ): Promise<{ id: string; shortId?: string }> {
    const parsed = parseSentryIssueRef(raw);
    const orgHint = str(args, "org") || str(args, "organization") || parsed.org;
    if (parsed.shortId) {
      const org = orgHint || (await this.resolveSentryOrg(root, account, args));
      const looked = (await this.getJson(
        joinUrl(
          root,
          `/organizations/${encodeURIComponent(org)}/shortids/${encodeURIComponent(parsed.shortId)}/`,
        ),
        account,
      )) as { groupID?: string; groupId?: string; group?: { id?: unknown; shortId?: string } };
      const id =
        sentryId(looked.group?.id) ||
        sentryId(looked.groupID) ||
        sentryId(looked.groupId) ||
        parsed.shortId;
      return { id, shortId: looked.group?.shortId?.trim() || parsed.shortId };
    }
    return { id: parsed.id ?? raw.trim() };
  }

  private async miro(
    name: string,
    args: Record<string, unknown>,
    account: IntegrationAccount,
  ): Promise<{ ok: boolean; output: string }> {
    if (name === "miro_list") {
      const rows = await this.miroPages("/v2/boards", account);
      const lines = rows.map((row) => {
        const rec = row as Record<string, unknown>;
        const id = typeof rec.id === "string" ? rec.id : "";
        const title = typeof rec.name === "string" ? rec.name : "Untitled";
        const link = typeof rec.viewLink === "string" ? rec.viewLink : "";
        return [id, title, link].filter(Boolean).join(" ");
      });
      return { ok: true, output: lines.join("\n") || "No Miro boards" };
    }
    if (name === "miro_export") {
      return this.miroExport(account, str(args, "board") || str(args, "board_id"), args);
    }
    const boardId = str(args, "board") || str(args, "board_id") || str(args, "miro_board_id");
    if (!boardId) return { ok: false, output: "board id is required" };
    const items = await this.miroPages(`/v2/boards/${encodeURIComponent(boardId)}/items`, account);
    let connectors: unknown[] = [];
    try {
      connectors = await this.miroPages(
        `/v2/boards/${encodeURIComponent(boardId)}/connectors`,
        account,
      );
    } catch {
      connectors = [];
    }
    const objects = importMiroItems(items, connectors);
    if (name === "miro_get") {
      const lines = objects.map((obj) => {
        const text = obj.text?.trim() || obj.label?.trim() || "";
        return `${obj.type}${text ? ` ${text}` : ""}`;
      });
      return {
        ok: true,
        output: `Miro ${boardId} (${objects.length} objects)\n${lines.slice(0, 80).join("\n")}${
          objects.length > 80 ? `\n… ${objects.length - 80} more` : ""
        }`,
      };
    }
    return { ok: true, output: encodeIntegrationJson({ board: boardId, objects }) };
  }

  private async miroExport(
    account: IntegrationAccount,
    boardId: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; output: string }> {
    const raw = Array.isArray(args.objects) ? args.objects : [];
    const objects = raw.map(parseBoardObject).filter((row): row is BoardObject => Boolean(row));
    if (!objects.length) return { ok: false, output: "objects[] is required (from board_get)" };
    let dest = boardId;
    let viewLink = "";
    if (!dest) {
      const board = (await this.sendJson(joinUrl(account.baseUrl, "/v2/boards"), account, {
        name: str(args, "name") || "Locus board",
      })) as { id?: string; viewLink?: string };
      dest = typeof board.id === "string" ? board.id.trim() : "";
      viewLink = typeof board.viewLink === "string" ? board.viewLink : "";
      if (!dest) return { ok: false, output: "Could not create a Miro board" };
    }
    const miroIds = new Map<string, string>();
    let created = 0;
    const skipped: string[] = [];
    for (const obj of objects) {
      if (obj.type === "connector") continue;
      const spec = locusObjectToMiroCreate(obj);
      if (!spec) {
        skipped.push(obj.type);
        continue;
      }
      const posted = (await this.sendJson(
        joinUrl(account.baseUrl, `/v2/boards/${encodeURIComponent(dest)}/${spec.kind}`),
        account,
        spec.body,
      )) as { id?: string };
      if (posted.id) {
        miroIds.set(obj.id, posted.id);
        created += 1;
      }
    }
    let wires = 0;
    for (const obj of objects) {
      const body = locusConnectorToMiroBody(obj, miroIds);
      if (!body) continue;
      await this.sendJson(
        joinUrl(account.baseUrl, `/v2/boards/${encodeURIComponent(dest)}/connectors`),
        account,
        body,
      );
      wires += 1;
    }
    const extra = skipped.length ? `; skipped ${[...new Set(skipped)].join(", ")}` : "";
    const link = viewLink ? ` ${viewLink}` : "";
    return {
      ok: true,
      output: `Exported ${created} items${wires ? ` and ${wires} connectors` : ""} to Miro ${dest}${link}${extra}`,
    };
  }

  private async miroPages(path: string, account: IntegrationAccount): Promise<unknown[]> {
    const out: unknown[] = [];
    let cursor: string | undefined;
    let offset = 0;
    let nextUrl: string | undefined;
    const offsetPaging = !path.includes("/items") && !path.includes("/connectors");
    for (let i = 0; i < 20; i++) {
      const url = nextUrl ? new URL(nextUrl) : new URL(joinUrl(account.baseUrl, path));
      if (!nextUrl) {
        url.searchParams.set("limit", "50");
        if (cursor) url.searchParams.set("cursor", cursor);
        else if (offsetPaging) url.searchParams.set("offset", String(offset));
      }
      const body = (await this.getJson(url, account)) as {
        data?: unknown[];
        cursor?: string;
        links?: { next?: string };
      };
      const page = Array.isArray(body.data) ? body.data : [];
      out.push(...page);
      const nextCursor = typeof body.cursor === "string" ? body.cursor.trim() : "";
      const linkNext =
        body.links && typeof body.links.next === "string" ? body.links.next.trim() : "";
      if (nextCursor) {
        cursor = nextCursor;
        nextUrl = undefined;
        continue;
      }
      if (linkNext) {
        nextUrl = linkNext;
        continue;
      }
      if (offsetPaging && page.length === 50) {
        offset += page.length;
        continue;
      }
      break;
    }
    return out;
  }

  private async figma(
    name: string,
    args: Record<string, unknown>,
    account: IntegrationAccount,
  ): Promise<{ ok: boolean; output: string }> {
    if (name === "figma_list") return this.figmaList(account, args);
    if (name === "figma_images") return this.figmaImages(account, args);
    if (name === "figma_comment") return this.figmaComment(account, args);
    return this.figmaGet(account, args);
  }

  private async figmaList(
    account: IntegrationAccount,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; output: string }> {
    const project = str(args, "project") || str(args, "project_id");
    const teamRaw = str(args, "team") || str(args, "team_id") || str(args, "url");
    const teamRef = parseFigmaTeamRef(teamRaw);
    const teamId = teamRef?.teamId || (/^\d+$/.test(teamRaw) ? teamRaw : "");
    const projectId = project || teamRef?.projectId || "";
    if (projectId) {
      const body = (await this.getJson(
        joinUrl(account.baseUrl, `/v1/projects/${encodeURIComponent(projectId)}/files`),
        account,
      )) as {
        name?: string;
        files?: Array<{ key?: string; name?: string; last_modified?: string }>;
      };
      const files = Array.isArray(body.files) ? body.files : [];
      const heading = typeof body.name === "string" && body.name.trim() ? `${body.name}\n` : "";
      const lines = files.map((row) =>
        [row.key, row.name, row.last_modified].filter(Boolean).join(" "),
      );
      return { ok: true, output: `${heading}${lines.join("\n")}`.trim() || "No Figma files" };
    }
    if (teamId) {
      const body = (await this.getJson(
        joinUrl(account.baseUrl, `/v1/teams/${encodeURIComponent(teamId)}/projects`),
        account,
      )) as { name?: string; projects?: Array<{ id?: number | string; name?: string }> };
      const projects = Array.isArray(body.projects) ? body.projects : [];
      const heading = typeof body.name === "string" && body.name.trim() ? `${body.name}\n` : "";
      const lines = projects.map((row) => `${row.id ?? ""} ${row.name ?? "Untitled"}`.trim());
      const hint = lines.length ? "\nPass project to list files." : "";
      return {
        ok: true,
        output: `${heading}${lines.join("\n")}${hint}`.trim() || "No Figma projects",
      };
    }
    const me = (await this.getJson(joinUrl(account.baseUrl, "/v1/me"), account)) as {
      id?: string;
      handle?: string;
      email?: string;
    };
    const who = [me.handle, me.email, me.id].filter(Boolean).join(" ");
    return {
      ok: true,
      output: `${who}\nPass team (figma.com/files/team/ID), project, or a file URL to figma_get.`,
    };
  }

  private async figmaGet(
    account: IntegrationAccount,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; output: string }> {
    const ref = figmaFileArg(args);
    if (!ref) return { ok: false, output: "file is required (file key or Figma URL)" };
    const ids = figmaNodeIds(args, ref.nodeId);
    if (ids.length) {
      const url = new URL(
        joinUrl(account.baseUrl, `/v1/files/${encodeURIComponent(ref.fileKey)}/nodes`),
      );
      url.searchParams.set("ids", ids.join(","));
      const body = await this.getJson(url, account);
      return {
        ok: true,
        output: encodeIntegrationJson({
          file: ref.fileKey,
          ...summarizeFigmaDocument(body, { depth: 4 }),
        }),
      };
    }
    const depth = figmaDepth(args);
    const url = new URL(joinUrl(account.baseUrl, `/v1/files/${encodeURIComponent(ref.fileKey)}`));
    url.searchParams.set("depth", String(depth));
    const body = await this.getJson(url, account);
    return {
      ok: true,
      output: encodeIntegrationJson({
        file: ref.fileKey,
        ...summarizeFigmaDocument(body, { depth: depth + 1 }),
      }),
    };
  }

  private async figmaImages(
    account: IntegrationAccount,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; output: string }> {
    const ref = figmaFileArg(args);
    if (!ref) return { ok: false, output: "file is required (file key or Figma URL)" };
    const ids = figmaNodeIds(args, ref.nodeId);
    if (!ids.length) return { ok: false, output: "ids or node is required" };
    const formatRaw = str(args, "format").toLowerCase();
    const format = ["png", "jpg", "svg", "pdf"].includes(formatRaw) ? formatRaw : "png";
    const url = new URL(joinUrl(account.baseUrl, `/v1/images/${encodeURIComponent(ref.fileKey)}`));
    url.searchParams.set("ids", ids.join(","));
    url.searchParams.set("format", format);
    url.searchParams.set("scale", String(figmaScale(args)));
    const body = (await this.getJson(url, account)) as {
      err?: string;
      images?: Record<string, string | null>;
    };
    if (body.err && !Object.values(body.images ?? {}).some(Boolean)) {
      return { ok: false, output: body.err };
    }
    return {
      ok: true,
      output: encodeIntegrationJson({ file: ref.fileKey, format, images: body.images ?? {} }),
    };
  }

  private async figmaComment(
    account: IntegrationAccount,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; output: string }> {
    const ref = figmaFileArg(args);
    const message = str(args, "message") || str(args, "body");
    if (!ref) return { ok: false, output: "file is required (file key or Figma URL)" };
    if (!message) return { ok: false, output: "message is required" };
    const node = str(args, "node") || str(args, "node_id") || ref.nodeId || "";
    const x = typeof args.x === "number" && Number.isFinite(args.x) ? args.x : 0;
    const y = typeof args.y === "number" && Number.isFinite(args.y) ? args.y : 0;
    const posted = (await this.sendJson(
      joinUrl(account.baseUrl, `/v1/files/${encodeURIComponent(ref.fileKey)}/comments`),
      account,
      {
        message,
        client_meta: node ? { node_id: figmaApiNodeId(node), node_offset: { x, y } } : { x, y },
      },
    )) as { id?: string };
    const id = typeof posted.id === "string" ? posted.id : "";
    return {
      ok: true,
      output: `Commented on ${ref.fileKey}${node ? ` node ${figmaApiNodeId(node)}` : ""}${
        id ? ` id=${id}` : ""
      }`,
    };
  }

  private async getJson(url: string | URL, account: IntegrationAccount): Promise<unknown> {
    const res = await this.fetchFn(url.toString(), { headers: authHeaders(account) });
    const text = await res.text();
    if (!res.ok) throw integrationHttpError(account, text, res.status);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { text: text.slice(0, 2_000) };
    }
  }

  private async sendJson(
    url: string,
    account: IntegrationAccount,
    body: unknown,
    method = "POST",
  ): Promise<unknown> {
    const res = await this.fetchFn(url, {
      method,
      headers: { ...authHeaders(account), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw integrationHttpError(account, text, res.status);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { text: text.slice(0, 2_000) };
    }
  }
}

function decodeSlackUploadBytes(args: Record<string, unknown>): Uint8Array | undefined {
  const b64 = str(args, "bytes_base64");
  if (b64) {
    const bytes = Buffer.from(b64, "base64");
    if (!bytes.byteLength) return undefined;
    if (bytes.byteLength > SLACK_UPLOAD_MAX_BYTES) throw new Error("file is larger than 20 MiB");
    return bytes;
  }
  const content = typeof args.content === "string" ? args.content : "";
  if (!content) return undefined;
  const bytes = Buffer.from(content, "utf8");
  if (bytes.byteLength > SLACK_UPLOAD_MAX_BYTES) throw new Error("file is larger than 20 MiB");
  return bytes;
}

function jiraAdf(text: string): {
  type: "doc";
  version: 1;
  content: Array<{ type: "paragraph"; content: Array<{ type: "text"; text: string }> }>;
} {
  return {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function jiraIssueKeys(args: Record<string, unknown>): string[] {
  const keys: string[] = [];
  const add = (raw: string) => {
    for (const part of raw.split(/[\s,]+/)) {
      const k = part.trim();
      if (k) keys.push(k);
    }
  };
  if (typeof args.issue === "string") add(args.issue);
  if (typeof args.key === "string") add(args.key);
  if (typeof args.issues === "string") add(args.issues);
  if (Array.isArray(args.issues)) {
    for (const row of args.issues) {
      if (typeof row === "string") add(row);
    }
  }
  return [...new Set(keys)];
}

function jiraParentKey(args: Record<string, unknown>): string {
  return str(args, "parent") || str(args, "epic") || str(args, "epic_link");
}

function jiraLabels(args: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(args.labels)) {
    const rows = args.labels
      .filter((row): row is string => typeof row === "string")
      .map((row) => row.trim())
      .filter(Boolean);
    return rows.length ? rows : undefined;
  }
  const raw = str(args, "labels");
  if (!raw) return undefined;
  const rows = raw.split(/[\s,]+/).filter(Boolean);
  return rows.length ? rows : undefined;
}

function jiraExtraFields(args: Record<string, unknown>): Record<string, unknown> {
  const raw = args.fields;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

function jiraUnsettableFields(message: string): string[] {
  const names: string[] = [];
  const re = /Field '([^']+)' cannot be set/gi;
  for (const match of message.matchAll(re)) {
    const name = match[1]?.trim();
    if (name) names.push(name);
  }
  return names;
}

function jiraIdOrKey(value: string): { id: string } | { key: string } {
  return /^\d+$/.test(value) ? { id: value } : { key: value };
}

function jiraIdOrName(value: string): { id: string } | { name: string } {
  return /^\d+$/.test(value) ? { id: value } : { name: value };
}

function incidentioIncidentId(args: Record<string, unknown>): string {
  return str(args, "incident") || str(args, "id") || str(args, "reference");
}

function incidentioLooksLikeId(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value.trim()) || /^[0-9a-f-]{16,}$/i.test(value.trim());
}

const INCIDENTIO_STATUS_CATEGORIES: Record<string, string> = {
  triage: "triage",
  live: "live",
  active: "live",
  learning: "learning",
  "post-incident": "learning",
  "post incident": "learning",
  paused: "paused",
  closed: "closed",
  declined: "declined",
  canceled: "canceled",
  cancelled: "canceled",
  merged: "merged",
};

function incidentioStatusCategory(value: string): string | undefined {
  if (!value) return undefined;
  return INCIDENTIO_STATUS_CATEGORIES[value.trim().toLowerCase()];
}

function incidentioMode(value: string): string | undefined {
  const mode = value.trim().toLowerCase();
  if (mode === "standard" || mode === "retrospective" || mode === "test" || mode === "tutorial") {
    return mode;
  }
  return undefined;
}

function incidentioPageSize(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 25;
  return Math.min(250, Math.max(1, Math.floor(n)));
}

function incidentioRecord(row: unknown): Record<string, unknown> {
  return row && typeof row === "object" && !Array.isArray(row)
    ? (row as Record<string, unknown>)
    : {};
}

function incidentioRef(row: unknown): string {
  const rec = incidentioRecord(row);
  const reference = typeof rec.reference === "string" ? rec.reference.trim() : "";
  const id = typeof rec.id === "string" ? rec.id.trim() : "";
  return reference || id;
}

function incidentioMatchesQuery(row: unknown, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const rec = incidentioRecord(row);
  const fields = [rec.reference, rec.id, rec.name, rec.summary];
  return fields.some((value) => typeof value === "string" && value.toLowerCase().includes(needle));
}

function incidentioSlim(row: unknown): Record<string, unknown> {
  const rec = incidentioRecord(row);
  const status = incidentioRecord(rec.incident_status);
  const severity = incidentioRecord(rec.severity);
  return {
    id: rec.id,
    reference: rec.reference,
    name: rec.name,
    summary: rec.summary,
    permalink: rec.permalink,
    created_at: rec.created_at,
    updated_at: rec.updated_at,
    status: status.name,
    status_category: status.category,
    severity: severity.name,
  };
}
function looksLikeJwt(token: string): boolean {
  const parts = token.split(".");
  return parts.length === 3 && Boolean(parts[0]?.startsWith("eyJ"));
}

function asRecordRows(body: unknown): Record<string, unknown>[] {
  const raw = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as { value?: unknown }).value)
      ? (body as { value: unknown[] }).value
      : [];
  return raw.filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object",
  );
}

function portainerEndpointHint(args: Record<string, unknown>): string {
  return (
    str(args, "endpoint") ||
    str(args, "endpointId") ||
    str(args, "environment") ||
    str(args, "environmentId")
  );
}

function portainerContainerRef(args: Record<string, unknown>): string {
  return str(args, "container") || str(args, "id") || str(args, "name");
}

function portainerContainerAction(
  args: Record<string, unknown>,
): "start" | "stop" | "restart" | undefined {
  const raw = str(args, "action").toLowerCase();
  return raw === "start" || raw === "stop" || raw === "restart" ? raw : undefined;
}

function portainerStackActionName(args: Record<string, unknown>): "start" | "stop" | undefined {
  const raw = str(args, "action").toLowerCase();
  return raw === "start" || raw === "stop" ? raw : undefined;
}

function portainerTail(args: Record<string, unknown>): number {
  const raw = args.tail;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 100;
  if (!Number.isFinite(n)) return 100;
  return Math.min(500, Math.max(1, Math.floor(n)));
}

function portainerNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value)))
    return Number(value);
  return undefined;
}

function portainerEndpointRef(row: Record<string, unknown>): {
  ok: true;
  id: number;
  name: string;
  type: number;
} {
  return {
    ok: true,
    id: portainerNum(row.Id) ?? 0,
    name: typeof row.Name === "string" ? row.Name : "",
    type: portainerNum(row.Type) ?? 0,
  };
}

function portainerEndpointMatches(row: Record<string, unknown>, hint: string): boolean {
  const id = portainerNum(row.Id);
  if (id !== undefined && String(id) === hint) return true;
  const name = typeof row.Name === "string" ? row.Name.trim() : "";
  return name.toLowerCase() === hint.toLowerCase();
}

function portainerStackMatches(row: Record<string, unknown>, hint: string): boolean {
  const id = portainerNum(row.Id);
  if (id !== undefined && String(id) === hint) return true;
  const name = typeof row.Name === "string" ? row.Name.trim() : "";
  return name.toLowerCase() === hint.toLowerCase();
}

function isDockerPortainerEndpoint(type: number): boolean {
  return type === 1 || type === 2 || type === 4;
}

function portainerEndpointTypeLabel(type: number): string {
  if (type === 1) return "docker";
  if (type === 2) return "agent";
  if (type === 3) return "azure";
  if (type === 4) return "edge-docker";
  if (type === 5) return "kubernetes";
  if (type === 6) return "k8s-agent";
  if (type === 7) return "edge-k8s";
  return `type-${type}`;
}

function portainerEndpointStatusLabel(status: unknown): string {
  const n = portainerNum(status);
  if (n === 1) return "up";
  if (n === 2) return "down";
  return n !== undefined ? `status-${n}` : "unknown";
}

function formatPortainerEndpoint(row: Record<string, unknown>): string {
  const id = portainerNum(row.Id);
  const name = typeof row.Name === "string" ? row.Name : "unnamed";
  const type = portainerEndpointTypeLabel(portainerNum(row.Type) ?? 0);
  const status = portainerEndpointStatusLabel(row.Status);
  return [id, name, status, type].filter((part) => part !== undefined && part !== "").join(" ");
}

function formatPortainerContainer(row: Record<string, unknown>): string {
  const id = typeof row.Id === "string" ? row.Id.slice(0, 12) : "";
  const names = Array.isArray(row.Names)
    ? row.Names.filter((n): n is string => typeof n === "string")
        .map((n) => n.replace(/^\//, ""))
        .join(",")
    : "";
  const image = typeof row.Image === "string" ? row.Image : "";
  const state =
    typeof row.State === "string" ? row.State : typeof row.Status === "string" ? row.Status : "";
  const ports = formatDockerPorts(row.Ports);
  return [id, names, state, image, ports].filter(Boolean).join(" ");
}

function formatDockerPorts(raw: unknown): string {
  if (!Array.isArray(raw)) return "";
  const parts: string[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const privatePort = portainerNum(rec.PrivatePort);
    if (privatePort === undefined) continue;
    const publicPort = portainerNum(rec.PublicPort);
    const proto = typeof rec.Type === "string" ? rec.Type : "tcp";
    parts.push(publicPort ? `${publicPort}:${privatePort}/${proto}` : `${privatePort}/${proto}`);
  }
  return parts.join(",");
}

function summarizePortainerInspect(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object") return { raw: body };
  const rec = body as Record<string, unknown>;
  const state =
    rec.State && typeof rec.State === "object" ? (rec.State as Record<string, unknown>) : {};
  const config =
    rec.Config && typeof rec.Config === "object" ? (rec.Config as Record<string, unknown>) : {};
  const host =
    rec.HostConfig && typeof rec.HostConfig === "object"
      ? (rec.HostConfig as Record<string, unknown>)
      : {};
  const net =
    rec.NetworkSettings && typeof rec.NetworkSettings === "object"
      ? (rec.NetworkSettings as Record<string, unknown>)
      : {};
  const names = Array.isArray(rec.Name) ? rec.Name : typeof rec.Name === "string" ? [rec.Name] : [];
  return {
    Id: typeof rec.Id === "string" ? rec.Id : undefined,
    Name: names.map((n) => String(n).replace(/^\//, "")).join(",") || undefined,
    Image: config.Image ?? rec.Image,
    State: state.Status ?? rec.State,
    Running: state.Running,
    ExitCode: state.ExitCode,
    StartedAt: state.StartedAt,
    FinishedAt: state.FinishedAt,
    RestartPolicy: (host.RestartPolicy as { Name?: string } | undefined)?.Name,
    Ports: net.Ports,
    EnvCount: Array.isArray(config.Env) ? config.Env.length : 0,
    Cmd: config.Cmd,
    Created: rec.Created,
  };
}

function summarizePortainerStack(row: Record<string, unknown>): Record<string, unknown> {
  return {
    Id: row.Id,
    Name: row.Name,
    Type:
      portainerNum(row.Type) === 1 ? "swarm" : portainerNum(row.Type) === 2 ? "compose" : row.Type,
    EndpointId: row.EndpointId,
    Status:
      portainerNum(row.Status) === 1
        ? "active"
        : portainerNum(row.Status) === 2
          ? "inactive"
          : row.Status,
  };
}

function formatPortainerStack(row: Record<string, unknown>): string {
  const summary = summarizePortainerStack(row);
  return [summary.Id, summary.Name, summary.Status, summary.Type, `endpoint=${summary.EndpointId}`]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
}

function demuxDockerLogs(buf: Buffer): string {
  if (
    buf.length >= 8 &&
    (buf[0] === 1 || buf[0] === 2) &&
    buf[1] === 0 &&
    buf[2] === 0 &&
    buf[3] === 0
  ) {
    const parts: string[] = [];
    let offset = 0;
    while (offset + 8 <= buf.length) {
      const size = buf.readUInt32BE(offset + 4);
      const end = offset + 8 + size;
      if (end > buf.length) break;
      parts.push(buf.subarray(offset + 8, end).toString("utf8"));
      offset = end;
    }
    return parts.join("");
  }
  return buf.toString("utf8");
}

function confluenceWikiRoot(account: IntegrationAccount): string {
  const base = account.baseUrl.replace(/\/+$/, "");
  try {
    const parsed = new URL(base);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "") || "";
    const cloudSite = host === "atlassian.net" || host.endsWith(".atlassian.net");
    const cloudEx = host === "api.atlassian.com" && /\/ex\/confluence(\/|$)/i.test(path);
    if ((cloudSite || cloudEx) && !path.endsWith("/wiki")) return `${base}/wiki`;
  } catch {
    return base;
  }
  return base;
}

function confluenceCql(raw: string): string {
  if (/[=~]|type\s*=|space\s*=|text\s/i.test(raw)) return raw;
  const escaped = raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `type=page AND text ~ "${escaped}"`;
}

function confluenceStorage(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "<p></p>";
  if (/^</.test(trimmed)) return trimmed;
  const escaped = trimmed.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((para) => `<p>${para.replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function confluencePageId(page: Record<string, unknown>): string {
  return typeof page.id === "string"
    ? page.id.trim()
    : typeof page.id === "number"
      ? String(page.id)
      : "";
}

function compactConfluenceSearch(body: unknown): unknown {
  if (!body || typeof body !== "object") return body;
  const rec = body as { results?: unknown[]; size?: number; start?: number };
  if (!Array.isArray(rec.results)) return body;
  return {
    size: rec.size ?? rec.results.length,
    results: rec.results.slice(0, 20).map((row) => compactConfluencePage(row, false)),
  };
}

function compactConfluencePage(row: unknown, includeBody: boolean): unknown {
  if (!row || typeof row !== "object") return row;
  const r = row as Record<string, unknown>;
  const space = r.space as { key?: string; name?: string } | undefined;
  const version = r.version as { number?: number } | undefined;
  const links = r._links as { webui?: string } | undefined;
  const storage = (r.body as { storage?: { value?: string } } | undefined)?.storage?.value;
  const out: Record<string, unknown> = {
    id: r.id,
    type: r.type,
    title: r.title,
    status: r.status,
  };
  if (space?.key) out.space = space.key;
  if (typeof version?.number === "number") out.version = version.number;
  if (typeof links?.webui === "string" && links.webui) out.webui = links.webui;
  if (includeBody && typeof storage === "string") out.body = storage;
  return out;
}

function figmaFileArg(args: Record<string, unknown>) {
  return parseFigmaFileRef(
    str(args, "file") || str(args, "url") || str(args, "file_key") || str(args, "key"),
  );
}

function figmaNodeIds(args: Record<string, unknown>, extra?: string): string[] {
  const raw = [str(args, "ids"), str(args, "node"), str(args, "node_id"), extra ?? ""]
    .filter(Boolean)
    .join(",");
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((part) => figmaApiNodeId(part))
        .filter(Boolean),
    ),
  ];
}

function figmaDepth(args: Record<string, unknown>): number {
  const n = typeof args.depth === "number" ? args.depth : Number(args.depth);
  if (!Number.isFinite(n)) return 2;
  return Math.min(8, Math.max(1, Math.round(n)));
}

function figmaScale(args: Record<string, unknown>): number {
  const n = typeof args.scale === "number" ? args.scale : Number(args.scale);
  if (!Number.isFinite(n)) return 2;
  return Math.min(4, Math.max(0.01, n));
}

function sentryApiRoot(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return /\/api\/0$/i.test(trimmed) ? trimmed : `${trimmed}/api/0`;
}

function sentryLimit(raw: unknown, fallback: number, max: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sentrySlug(value: unknown): string {
  const rec = asRecord(value);
  const slug = typeof rec.slug === "string" ? rec.slug.trim() : "";
  return slug;
}

function sentryId(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" ? value.trim() : "";
}

function parseSentryIssueRef(raw: string): { id?: string; shortId?: string; org?: string } {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    const parts = url.pathname.split("/").filter(Boolean);
    const orgIdx = parts.indexOf("organizations");
    const issuesIdx = parts.indexOf("issues");
    const org = orgIdx >= 0 ? parts[orgIdx + 1] : undefined;
    if (issuesIdx >= 0 && parts[issuesIdx + 1]) {
      const token = parts[issuesIdx + 1] ?? "";
      if (/^\d+$/.test(token)) return { id: token, org };
      if (/^[A-Z][A-Z0-9_]*-\d+$/i.test(token)) return { shortId: token, org };
    }
  } catch {
    /* not a URL */
  }
  if (/^\d+$/.test(trimmed)) return { id: trimmed };
  if (/^[A-Z][A-Z0-9_]*-\d+$/i.test(trimmed)) return { shortId: trimmed };
  return { id: trimmed };
}

function compactSentryProject(value: unknown): Record<string, unknown> {
  const rec = asRecord(value);
  return {
    id: rec.id,
    slug: rec.slug,
    name: rec.name,
    platform: rec.platform,
    status: rec.status,
  };
}

function compactSentryIssue(value: unknown): Record<string, unknown> {
  const rec = asRecord(value);
  const project = asRecord(rec.project);
  const assigned = asRecord(rec.assignedTo);
  return {
    id: rec.id,
    shortId: rec.shortId,
    title: rec.title,
    culprit: rec.culprit,
    status: rec.status,
    level: rec.level,
    count: rec.count,
    userCount: rec.userCount,
    firstSeen: rec.firstSeen,
    lastSeen: rec.lastSeen,
    permalink: rec.permalink,
    project: project.slug ?? project.name,
    assignedTo: assigned.name ?? assigned.email ?? rec.assignedTo,
    metadata: rec.metadata,
  };
}

function compactSentryEvent(value: unknown): Record<string, unknown> {
  const rec = asRecord(value);
  const tags = Array.isArray(rec.tags)
    ? rec.tags
        .map((row) => {
          const tag = asRecord(row);
          const key = typeof tag.key === "string" ? tag.key : "";
          const val = typeof tag.value === "string" ? tag.value : "";
          return key ? `${key}=${val}` : "";
        })
        .filter(Boolean)
        .slice(0, 20)
    : [];
  const entries = Array.isArray(rec.entries) ? rec.entries : [];
  const exceptions: unknown[] = [];
  let request: Record<string, unknown> | undefined;
  for (const entry of entries) {
    const row = asRecord(entry);
    if (row.type === "exception") {
      const values = asRecord(row.data).values;
      if (Array.isArray(values)) exceptions.push(...values.map(compactSentryException));
    }
    if (row.type === "request") {
      const data = asRecord(row.data);
      request = { method: data.method, url: data.url };
    }
  }
  const user = asRecord(rec.user);
  return {
    eventID: rec.eventID ?? rec.id,
    dateCreated: rec.dateCreated,
    platform: rec.platform,
    title: rec.title,
    message: rec.message,
    tags,
    user: user.email ?? user.username ?? user.id ?? undefined,
    request,
    exceptions,
  };
}

function compactSentryException(value: unknown): Record<string, unknown> {
  const rec = asRecord(value);
  const stack = asRecord(rec.stacktrace);
  const frames = Array.isArray(stack.frames) ? stack.frames.map(compactSentryFrame) : [];
  const inApp = frames.filter((frame) => frame.inApp);
  return {
    type: rec.type,
    value: rec.value,
    frames: (inApp.length ? inApp : frames).slice(-20),
  };
}

function compactSentryFrame(value: unknown): Record<string, unknown> {
  const rec = asRecord(value);
  return {
    filename: rec.filename ?? rec.absPath,
    function: rec.function,
    lineNo: rec.lineNo,
    colNo: rec.colNo,
    inApp: rec.inApp === true,
  };
}
