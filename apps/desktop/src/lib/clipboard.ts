export async function pullGuestClipboard(
  exec: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ ok: boolean; output: string } | null>,
  writeHost: (text: string) => Promise<void>,
): Promise<number> {
  const result = await exec("clipboard_get", {});
  if (!result?.ok) throw new Error(result?.output || "Could not read the guest clipboard");
  await writeHost(result.output);
  return result.output.length;
}

export async function pushGuestClipboard(
  readHost: () => Promise<string>,
  exec: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ ok: boolean; output: string } | null>,
): Promise<number> {
  const text = await readHost();
  const result = await exec("clipboard_set", { text });
  if (!result?.ok) throw new Error(result?.output || "Could not write the guest clipboard");
  return text.length;
}
