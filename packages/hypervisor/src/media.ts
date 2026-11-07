export function isGuestDiskImage(path: string): boolean {
  return /\.(img|qcow2?|raw|vmdk)$/i.test(path.trim());
}
