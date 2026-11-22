export const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

const EN: Record<string, string> = {
  "empty.firstTask.title": "Try a first task",
  "empty.firstTask.body":
    "List files in /workspace and write hello.txt. Works on Host with no repo.",
  "empty.firstTask.cta": "Fill the composer",
  "setup.firstTask.hint": "After setup, the Agents empty state offers a first Host task.",
  "sample.title": "Try a sample task",
  "sample.body":
    "No repo linked yet. A Host agent fixes a failing test in a small sample repo. Nothing is pushed.",
  "sample.cta": "Try a sample task",
  "sample.starting": "Starting…",
  "sample.needsProvider": "Add a provider first",
  "phone.more.settings": "Settings",
  "phone.more.automation": "New job",
  "phone.more.palette": "Command palette",
  "phone.more.find": "Find in chat",
  "phone.more.vnc": "VM display (view only)",
  "phone.desktopOnly": "Live VNC control still needs the desktop.",
  "usage.total": "{total} total ({llm} LLM · {vm} VM)",
  "updates.downloadVerify": "Download and verify",
  "updates.verified": "Verified {name} ({sha256})",
  "updates.open": "Open installer",
  "workers.azure": "Azure",
  "workers.gcp": "GCP",
  "onboarding.skip": "Skip for now",
};

const CATALOG: Record<Locale, Record<string, string>> = { en: EN };

export function parseLocale(raw: unknown): Locale {
  return raw === "en" ? "en" : DEFAULT_LOCALE;
}

export function t(
  key: string,
  vars: Record<string, string | number> = {},
  locale: Locale = DEFAULT_LOCALE,
): string {
  const table = CATALOG[locale] ?? EN;
  let out = table[key] ?? EN[key] ?? key;
  for (const [name, value] of Object.entries(vars)) {
    out = out.replaceAll(`{${name}}`, String(value));
  }
  return out;
}
