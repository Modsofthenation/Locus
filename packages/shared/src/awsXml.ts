/** Tiny AWS Query XML reader. Enough for IAM / STS response bodies. */

export function parseAwsXml(xml: string): unknown {
  const stripped = xml.replace(/<\?xml[^?]*\?>/i, "").trim();
  if (!stripped) return {};
  const parsed = readNodes(stripped);
  if (parsed.nodes.length === 1) return parsed.nodes[0]!.value;
  return objectFrom(parsed.nodes);
}

export function awsQueryResult(body: unknown, action: string): unknown {
  if (!body || typeof body !== "object") return body;
  const root = body as Record<string, unknown>;
  const response = pick(root, `${action}Response`) ?? root;
  if (!response || typeof response !== "object") return response;
  const rec = response as Record<string, unknown>;
  return pick(rec, `${action}Result`) ?? rec;
}

export function awsXmlError(xml: string, action: string, status: number): string {
  try {
    const parsed = parseAwsXml(xml);
    const err = findError(parsed);
    if (err.code || err.message) {
      const bits = [err.code, err.message].filter(Boolean).join(": ");
      return `AWS ${action} failed: ${bits}`;
    }
  } catch {
    /* raw */
  }
  const snippet = xml.replace(/\s+/g, " ").trim().slice(0, 240);
  return snippet
    ? `AWS ${action} failed (${status}): ${snippet}`
    : `AWS ${action} failed (${status})`;
}

type NodeValue = { tag: string; value: unknown };

function readNodes(input: string): { nodes: NodeValue[]; rest: string } {
  const nodes: NodeValue[] = [];
  let rest = input.trim();
  while (rest.startsWith("<") && !rest.startsWith("</")) {
    const open = /^<([A-Za-z_][\w:.-]*)([^>]*)>/.exec(rest);
    if (!open) break;
    const rawTag = open[1]!;
    const tag = rawTag.replace(/^.*:/, "");
    const attrs = open[2] ?? "";
    if (attrs.includes("/>") || attrs.trimEnd().endsWith("/")) {
      nodes.push({ tag, value: "" });
      rest = rest.slice(open[0].length).trim();
      continue;
    }
    rest = rest.slice(open[0].length);
    const close = `</${rawTag}>`;
    const closeAt = rest.indexOf(close);
    if (closeAt < 0) break;
    const inner = rest.slice(0, closeAt);
    rest = rest.slice(closeAt + close.length).trim();
    if (!inner.trim()) {
      nodes.push({ tag, value: "" });
      continue;
    }
    if (!inner.trim().startsWith("<")) {
      nodes.push({ tag, value: decode(inner) });
      continue;
    }
    const child = readNodes(inner);
    nodes.push({ tag, value: collapse(child.nodes) });
  }
  return { nodes, rest };
}

function collapse(nodes: NodeValue[]): unknown {
  if (!nodes.length) return "";
  if (nodes.every((row) => row.tag === "member" || row.tag === "item")) {
    return nodes.map((row) => row.value);
  }
  return objectFrom(nodes);
}

function objectFrom(nodes: NodeValue[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const row of nodes) {
    if (row.tag in out) {
      const prev = out[row.tag];
      out[row.tag] = Array.isArray(prev) ? [...prev, row.value] : [prev, row.value];
    } else {
      out[row.tag] = row.value;
    }
  }
  return out;
}

function pick(row: Record<string, unknown>, key: string): unknown {
  if (key in row) return row[key];
  const found = Object.entries(row).find(([name]) => name.toLowerCase() === key.toLowerCase());
  return found?.[1];
}

function findError(value: unknown): { code?: string; message?: string } {
  if (!value || typeof value !== "object") return {};
  const row = value as Record<string, unknown>;
  const nested = row.Error ?? row.ErrorResponse ?? row.Response;
  if (nested && nested !== value) {
    const fromNested = findError(nested);
    if (fromNested.code || fromNested.message) return fromNested;
  }
  const code = typeof row.Code === "string" ? row.Code : undefined;
  const message = typeof row.Message === "string" ? row.Message : undefined;
  return { code, message };
}

function decode(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}
