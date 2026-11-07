import {
  DRIVE_UPLOAD_MAX_BYTES,
  GOOGLE_OAUTH_TOKEN,
  encodeIntegrationJson,
  googleAccessToken,
  googleOauthClientIdEnv,
  googleOauthClientSecretEnv,
  googleTokenExpired,
  isGoogleIntegrationKind,
  isMaskedSecret,
  type IntegrationAccount,
  type IntegrationToolName,
} from "@locus/shared";

export type GoogleFetcher = typeof fetch;
export type PersistIntegration = (id: string, patch: Partial<IntegrationAccount>) => Promise<void>;

function str(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value.trim() : "";
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function googleError(text: string, status: number): Error {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } | string };
    const message =
      typeof body.error === "string"
        ? body.error
        : typeof body.error?.message === "string"
          ? body.error.message
          : "";
    if (message) return new Error(`HTTP ${status}: ${message}`);
  } catch {
    /* raw */
  }
  return new Error(text.slice(0, 400).trim() || `HTTP ${status}`);
}

export function resolveGoogleClientId(account: IntegrationAccount, override?: string): string {
  return (
    override?.trim() ||
    account.oauthClientId?.trim() ||
    process.env[googleOauthClientIdEnv()]?.trim() ||
    ""
  );
}

export function resolveGoogleClientSecret(account: IntegrationAccount, override?: string): string {
  const fromInput = override?.trim();
  if (fromInput && !isMaskedSecret(fromInput)) return fromInput;
  return (
    account.oauthClientSecret?.trim() || process.env[googleOauthClientSecretEnv()]?.trim() || ""
  );
}

export async function refreshGoogleAccessToken(
  account: IntegrationAccount,
  fetchFn: GoogleFetcher,
): Promise<Partial<IntegrationAccount>> {
  const refresh = account.refreshToken?.trim();
  if (!refresh) throw new Error("Google access token expired. Sign in with Google again.");
  const clientId = resolveGoogleClientId(account);
  const clientSecret = resolveGoogleClientSecret(account);
  if (!clientId || !clientSecret) {
    throw new Error(
      `Add a Google OAuth client ID and secret (or set ${googleOauthClientIdEnv()} / ${googleOauthClientSecretEnv()}) to refresh the token.`,
    );
  }
  const res = await fetchFn(GOOGLE_OAUTH_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw googleError(text, res.status);
  const body = JSON.parse(text) as { access_token?: string; expires_in?: number };
  const token = typeof body.access_token === "string" ? body.access_token.trim() : "";
  if (!token) throw new Error("Google did not return an access token.");
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 3600;
  return {
    token,
    tokenExpiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    authMethod: "oauth",
  };
}

async function ensureGoogleToken(
  account: IntegrationAccount,
  fetchFn: GoogleFetcher,
  persist?: PersistIntegration,
): Promise<IntegrationAccount> {
  let current = account;
  const access = googleAccessToken(current);
  if (access && !googleTokenExpired(current)) return current;
  if (!current.refreshToken?.trim()) {
    if (access) return current;
    throw new Error("Add a Gmail, Calendar, or Drive token in Settings → Integrations");
  }
  const patch = await refreshGoogleAccessToken(current, fetchFn);
  current = { ...current, ...patch };
  if (persist) await persist(current.id, patch);
  return current;
}

export async function callGoogleTool(
  name: IntegrationToolName,
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: GoogleFetcher,
  persist?: PersistIntegration,
): Promise<{ ok: boolean; output: string }> {
  if (!isGoogleIntegrationKind(account.kind)) {
    return { ok: false, output: `Unsupported Google account ${account.kind}` };
  }
  let current = await ensureGoogleToken(account, fetchFn, persist);
  try {
    return await dispatchGoogle(name, args, current, fetchFn);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (!/HTTP 401/.test(message) || !current.refreshToken?.trim()) throw err;
    const patch = await refreshGoogleAccessToken(current, fetchFn);
    current = { ...current, ...patch };
    if (persist) await persist(current.id, patch);
    return await dispatchGoogle(name, args, current, fetchFn);
  }
}

async function dispatchGoogle(
  name: string,
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: GoogleFetcher,
): Promise<{ ok: boolean; output: string }> {
  if (name.startsWith("gmail_")) return gmail(name, args, account, fetchFn);
  if (name.startsWith("calendar_")) return calendar(name, args, account, fetchFn);
  return drive(name, args, account, fetchFn);
}

async function gmail(
  name: string,
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: GoogleFetcher,
): Promise<{ ok: boolean; output: string }> {
  if (name === "gmail_search") {
    const q = str(args, "q") || str(args, "query");
    const max = clamp(typeof args.max === "number" ? args.max : 20, 1, 50);
    const url = new URL(joinUrl(account.baseUrl, "/gmail/v1/users/me/messages"));
    if (q) url.searchParams.set("q", q);
    url.searchParams.set("maxResults", String(max));
    const listed = (await getJson(url, account, fetchFn)) as {
      messages?: Array<{ id?: string; threadId?: string }>;
    };
    const rows = listed.messages ?? [];
    if (!rows.length) return { ok: true, output: "No messages" };
    const lines: string[] = [];
    for (const row of rows.slice(0, max)) {
      const id = row.id?.trim();
      if (!id) continue;
      const meta = new URL(
        joinUrl(account.baseUrl, `/gmail/v1/users/me/messages/${encodeURIComponent(id)}`),
      );
      meta.searchParams.set("format", "metadata");
      meta.searchParams.append("metadataHeaders", "From");
      meta.searchParams.append("metadataHeaders", "Subject");
      meta.searchParams.append("metadataHeaders", "Date");
      const msg = (await getJson(meta, account, fetchFn)) as GmailMessage;
      lines.push(formatGmailLine(msg));
    }
    return { ok: true, output: lines.join("\n") || "No messages" };
  }
  if (name === "gmail_get") {
    const id = str(args, "id") || str(args, "message");
    if (!id) return { ok: false, output: "id is required" };
    const msg = (await getJson(
      joinUrl(account.baseUrl, `/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`),
      account,
      fetchFn,
    )) as GmailMessage;
    return { ok: true, output: formatGmailFull(msg) };
  }
  const to = str(args, "to");
  const subject = str(args, "subject");
  const body = str(args, "body") || str(args, "text");
  if (!to || !subject || !body) return { ok: false, output: "to, subject, and body are required" };
  const raw = encodeRfc822({
    to,
    subject,
    body,
    cc: str(args, "cc"),
    bcc: str(args, "bcc"),
  });
  const payload: { raw: string; threadId?: string } = { raw };
  const threadId = str(args, "thread_id") || str(args, "threadId");
  if (threadId) payload.threadId = threadId;
  const sent = (await sendJson(
    joinUrl(account.baseUrl, "/gmail/v1/users/me/messages/send"),
    account,
    payload,
    fetchFn,
  )) as { id?: string; threadId?: string };
  return {
    ok: true,
    output: sent.id ? `Sent ${sent.id}${sent.threadId ? ` thread=${sent.threadId}` : ""}` : "Sent",
  };
}

async function calendar(
  name: string,
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: GoogleFetcher,
): Promise<{ ok: boolean; output: string }> {
  const calendarId = str(args, "calendar") || "primary";
  if (name === "calendar_list") {
    if (args.calendars === true) {
      const body = (await getJson(
        joinUrl(account.baseUrl, "/calendar/v3/users/me/calendarList"),
        account,
        fetchFn,
      )) as { items?: Array<{ id?: string; summary?: string; primary?: boolean }> };
      const lines = (body.items ?? []).map((row) => {
        const id = row.id?.trim() ?? "";
        const summary = row.summary?.trim() || "Untitled";
        return `${id} ${summary}${row.primary ? " (primary)" : ""}`.trim();
      });
      return { ok: true, output: lines.join("\n") || "No calendars" };
    }
    const url = new URL(
      joinUrl(account.baseUrl, `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`),
    );
    const timeMin = str(args, "time_min") || str(args, "timeMin") || new Date().toISOString();
    url.searchParams.set("timeMin", timeMin);
    const timeMax = str(args, "time_max") || str(args, "timeMax");
    if (timeMax) url.searchParams.set("timeMax", timeMax);
    const q = str(args, "q") || str(args, "query");
    if (q) url.searchParams.set("q", q);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set(
      "maxResults",
      String(clamp(typeof args.max === "number" ? args.max : 20, 1, 50)),
    );
    const body = (await getJson(url, account, fetchFn)) as { items?: CalendarEvent[] };
    const lines = (body.items ?? []).map(formatCalendarEvent);
    return { ok: true, output: lines.join("\n") || "No events" };
  }
  if (name === "calendar_get") {
    const eventId = str(args, "event") || str(args, "id");
    if (!eventId) return { ok: false, output: "event id is required" };
    const event = (await getJson(
      joinUrl(
        account.baseUrl,
        `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      ),
      account,
      fetchFn,
    )) as CalendarEvent;
    return { ok: true, output: encodeIntegrationJson(event) };
  }
  const summary = str(args, "summary") || str(args, "title");
  const start = str(args, "start");
  const end = str(args, "end");
  if (!summary || !start || !end) {
    return { ok: false, output: "summary, start, and end are required" };
  }
  const attendees = parseEmails(str(args, "attendees"));
  const created = (await sendJson(
    joinUrl(account.baseUrl, `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`),
    account,
    {
      summary,
      description: str(args, "description") || undefined,
      location: str(args, "location") || undefined,
      start: calendarWhen(start),
      end: calendarWhen(end),
      ...(attendees.length ? { attendees: attendees.map((email) => ({ email })) } : {}),
    },
    fetchFn,
  )) as CalendarEvent;
  const html = created.htmlLink?.trim();
  return {
    ok: true,
    output: `Created ${created.id ?? "event"}${created.summary ? ` ${created.summary}` : ""}${html ? ` ${html}` : ""}`,
  };
}

async function drive(
  name: string,
  args: Record<string, unknown>,
  account: IntegrationAccount,
  fetchFn: GoogleFetcher,
): Promise<{ ok: boolean; output: string }> {
  if (name === "drive_list") {
    const url = new URL(joinUrl(account.baseUrl, "/drive/v3/files"));
    const folder = str(args, "folder");
    const qParts = [str(args, "q") || str(args, "query") || "trashed = false"];
    if (folder) qParts.push(`'${folder.replace(/'/g, "\\'")}' in parents`);
    url.searchParams.set("q", qParts.join(" and "));
    url.searchParams.set(
      "pageSize",
      String(clamp(typeof args.max === "number" ? args.max : 20, 1, 50)),
    );
    url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,size,webViewLink,parents)");
    const body = (await getJson(url, account, fetchFn)) as { files?: DriveFile[] };
    const lines = (body.files ?? []).map((row) => {
      const size = row.size ? ` ${row.size}B` : "";
      const link = row.webViewLink ? ` ${row.webViewLink}` : "";
      return `${row.id ?? ""} ${row.name ?? "Untitled"} ${row.mimeType ?? ""}${size}${link}`.trim();
    });
    return { ok: true, output: lines.join("\n") || "No files" };
  }
  if (name === "drive_get") {
    const fileId = str(args, "file") || str(args, "id");
    if (!fileId) return { ok: false, output: "file id is required" };
    const meta = (await getJson(
      joinUrl(
        account.baseUrl,
        `/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,modifiedTime,size,webViewLink,parents,md5Checksum`,
      ),
      account,
      fetchFn,
    )) as DriveFile;
    const text = await maybeDriveText(account, meta, fileId, fetchFn);
    if (!text) return { ok: true, output: encodeIntegrationJson(meta) };
    return {
      ok: true,
      output: `${encodeIntegrationJson(meta)}\n\n${text}`,
    };
  }
  const filename = str(args, "name") || str(args, "filename");
  if (!filename) return { ok: false, output: "name is required" };
  const bytes = decodeUploadBytes(args);
  if (!bytes) return { ok: false, output: "content or bytes_base64 is required" };
  const mime = str(args, "mime") || guessMime(filename);
  const folder = str(args, "folder");
  const metadata: Record<string, unknown> = { name: filename };
  if (folder) metadata.parents = [folder];
  const boundary = `locus_${Date.now().toString(16)}`;
  const header = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mime}`,
    "Content-Transfer-Encoding: binary",
    "",
  ].join("\r\n");
  const footer = `\r\n--${boundary}--`;
  const body = Buffer.concat([
    Buffer.from(header, "utf8"),
    Buffer.from(bytes),
    Buffer.from(footer),
  ]);
  const uploaded = (await sendRaw(
    joinUrl(account.baseUrl, "/upload/drive/v3/files?uploadType=multipart"),
    account,
    body,
    `multipart/related; boundary=${boundary}`,
    fetchFn,
  )) as DriveFile;
  const link = uploaded.webViewLink?.trim();
  return {
    ok: true,
    output: `Uploaded ${uploaded.name ?? filename}${uploaded.id ? ` ${uploaded.id}` : ""}${link ? ` ${link}` : ""}`,
  };
}

async function maybeDriveText(
  account: IntegrationAccount,
  meta: DriveFile,
  fileId: string,
  fetchFn: GoogleFetcher,
): Promise<string | undefined> {
  const mime = (meta.mimeType ?? "").toLowerCase();
  const size = Number(meta.size ?? 0);
  const textish =
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime.endsWith("+json") ||
    mime.endsWith("+xml");
  if (!textish || size > 200_000) return undefined;
  const res = await fetchFn(
    joinUrl(account.baseUrl, `/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`),
    { headers: googleHeaders(account) },
  );
  const text = await res.text();
  if (!res.ok) return undefined;
  return text.slice(0, 20_000);
}

function googleHeaders(account: IntegrationAccount): Record<string, string> {
  const token = googleAccessToken(account);
  if (!token) throw new Error("Add a Gmail, Calendar, or Drive token in Settings → Integrations");
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

async function getJson(
  url: string | URL,
  account: IntegrationAccount,
  fetchFn: GoogleFetcher,
): Promise<unknown> {
  const res = await fetchFn(url.toString(), { headers: googleHeaders(account) });
  const text = await res.text();
  if (!res.ok) throw googleError(text, res.status);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text: text.slice(0, 2_000) };
  }
}

async function sendJson(
  url: string,
  account: IntegrationAccount,
  body: unknown,
  fetchFn: GoogleFetcher,
): Promise<unknown> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { ...googleHeaders(account), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw googleError(text, res.status);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text: text.slice(0, 2_000) };
  }
}

async function sendRaw(
  url: string,
  account: IntegrationAccount,
  body: Buffer,
  contentType: string,
  fetchFn: GoogleFetcher,
): Promise<unknown> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: { ...googleHeaders(account), "Content-Type": contentType },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw googleError(text, res.status);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text: text.slice(0, 2_000) };
  }
}

type GmailMessage = {
  id?: string;
  threadId?: string;
  snippet?: string;
  payload?: {
    headers?: Array<{ name?: string; value?: string }>;
    mimeType?: string;
    body?: { data?: string };
    parts?: GmailMessage["payload"][];
  };
};

function gmailHeader(msg: GmailMessage, name: string): string {
  const needle = name.toLowerCase();
  return (
    msg.payload?.headers?.find((row) => (row.name ?? "").toLowerCase() === needle)?.value?.trim() ??
    ""
  );
}

function formatGmailLine(msg: GmailMessage): string {
  const from = gmailHeader(msg, "From") || "?";
  const subject = gmailHeader(msg, "Subject") || "(no subject)";
  const date = gmailHeader(msg, "Date");
  return [msg.id, date, from, subject, msg.snippet].filter(Boolean).join(" · ");
}

function formatGmailFull(msg: GmailMessage): string {
  const from = gmailHeader(msg, "From");
  const to = gmailHeader(msg, "To");
  const subject = gmailHeader(msg, "Subject");
  const date = gmailHeader(msg, "Date");
  const body = decodeGmailBody(msg.payload) || msg.snippet || "";
  return [
    `id ${msg.id ?? ""}`,
    msg.threadId ? `thread ${msg.threadId}` : "",
    date ? `date ${date}` : "",
    from ? `from ${from}` : "",
    to ? `to ${to}` : "",
    subject ? `subject ${subject}` : "",
    body,
  ]
    .filter(Boolean)
    .join("\n");
}

function decodeGmailBody(part: GmailMessage["payload"] | undefined): string {
  if (!part) return "";
  const mime = (part.mimeType ?? "").toLowerCase();
  if (part.body?.data && (mime === "text/plain" || mime === "text/html" || !part.parts?.length)) {
    const text = decodeBase64Url(part.body.data);
    if (mime === "text/html")
      return text
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return text;
  }
  const plain = part.parts?.find((row) => (row?.mimeType ?? "").toLowerCase() === "text/plain");
  if (plain) return decodeGmailBody(plain);
  const html = part.parts?.find((row) => (row?.mimeType ?? "").toLowerCase() === "text/html");
  if (html) return decodeGmailBody(html);
  for (const child of part.parts ?? []) {
    const nested = decodeGmailBody(child);
    if (nested) return nested;
  }
  return "";
}

function decodeBase64Url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}

function encodeRfc822(input: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}): string {
  const lines = [
    `To: ${input.to}`,
    input.cc ? `Cc: ${input.cc}` : "",
    input.bcc ? `Bcc: ${input.bcc}` : "",
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.body,
  ].filter((row) => row !== "");
  return Buffer.from(lines.join("\r\n"))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

type CalendarEvent = {
  id?: string;
  summary?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  attendees?: Array<{ email?: string }>;
};

function formatCalendarEvent(event: CalendarEvent): string {
  const start = event.start?.dateTime || event.start?.date || "";
  const end = event.end?.dateTime || event.end?.date || "";
  const who = (event.attendees ?? [])
    .map((row) => row.email)
    .filter(Boolean)
    .join(",");
  return [event.id, start, end, event.summary, event.location, who].filter(Boolean).join(" · ");
}

function calendarWhen(value: string): { date?: string; dateTime?: string } {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? { date: value } : { dateTime: value };
}

type DriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  size?: string;
  webViewLink?: string;
  parents?: string[];
  md5Checksum?: string;
};

function parseEmails(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,]+/)
        .map((row) => row.trim())
        .filter(Boolean),
    ),
  ];
}

function decodeUploadBytes(args: Record<string, unknown>): Uint8Array | undefined {
  const b64 = str(args, "bytes_base64");
  if (b64) {
    const bytes = Buffer.from(b64, "base64");
    if (!bytes.byteLength) return undefined;
    if (bytes.byteLength > DRIVE_UPLOAD_MAX_BYTES) throw new Error("file is larger than 20 MiB");
    return bytes;
  }
  const content = typeof args.content === "string" ? args.content : "";
  if (!content) return undefined;
  const bytes = Buffer.from(content, "utf8");
  if (bytes.byteLength > DRIVE_UPLOAD_MAX_BYTES) throw new Error("file is larger than 20 MiB");
  return bytes;
}

function guessMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}
