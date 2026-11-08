export type ConfirmOptions = {
  title: string;
  body: string;
  confirmLabel?: string;
  danger?: boolean;
};

export type PromptOptions = {
  title: string;
  body?: string;
  value?: string;
  confirmLabel?: string;
};

export type AlertOptions = {
  title?: string;
  body: string;
};

type DialogHostApi = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  alert: (opts: AlertOptions) => Promise<void>;
};

let host: DialogHostApi | null = null;

export function bindDialogHost(next: DialogHostApi | null): void {
  host = next;
}

export async function askConfirm(opts: ConfirmOptions | string): Promise<boolean> {
  const options: ConfirmOptions =
    typeof opts === "string" ? { title: "Confirm", body: opts, confirmLabel: "OK" } : opts;
  if (host) return host.confirm(options);
  return window.confirm(options.body);
}

export async function askPrompt(
  opts: PromptOptions | string,
  value?: string,
): Promise<string | null> {
  const options: PromptOptions = typeof opts === "string" ? { title: opts, value } : opts;
  if (host) return host.prompt(options);
  const raw = window.prompt(options.title, options.value ?? "");
  return raw;
}

export async function askAlert(opts: AlertOptions | string): Promise<void> {
  const options: AlertOptions = typeof opts === "string" ? { body: opts } : opts;
  if (host) {
    await host.alert(options);
    return;
  }
  window.alert(options.body);
}
