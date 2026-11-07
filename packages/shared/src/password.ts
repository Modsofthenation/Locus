/** Well-known passwords from early installs. Settings warns on these; new templates do not use them. */
export const LEGACY_LINUX_GUEST_PASSWORD = "locus";
export const LEGACY_WINDOWS_GUEST_PASSWORD = "Locus!dev1";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

export function isDefaultGuestPassword(value: string | undefined): boolean {
  return value === LEGACY_LINUX_GUEST_PASSWORD || value === LEGACY_WINDOWS_GUEST_PASSWORD;
}

/** Password that satisfies Windows complexity without XML-special characters. */
export function generateGuestPassword(): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let body = "";
  for (const byte of bytes) body += ALPHABET[byte % ALPHABET.length];
  return `Locus.${body}!`;
}
