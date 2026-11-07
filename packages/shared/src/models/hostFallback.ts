/** Host last-resort draft stamped onto an empty canvas after the loop. */
export const HOST_FALLBACK_ATTR = "data-locus-host-fallback";

function countTrue(flags: readonly boolean[]): number {
  let n = 0;
  for (const flag of flags) if (flag) n += 1;
  return n;
}

/** Unique Design stub clusters — not common editorial CSS on their own. */
function designStubHits(text: string): number {
  return countTrue([
    /color-mix\s*\(\s*in srgb,\s*var\(--text\)\s*14%,\s*var\(--bg\)\s*\)/i.test(text),
    />\s*First draft\s*</i.test(text),
    /class\s*=\s*["']cta["']/i.test(text) && /href\s*=\s*["']#next["']/i.test(text),
    /max-width:\s*40rem;\s*margin:\s*0 auto;\s*padding:\s*calc\(\s*var\(--space\)\s*\*\s*8\s*\)/i.test(
      text,
    ),
    /display:\s*inline-block;\s*padding:\s*calc\(\s*var\(--space\)\s*\*\s*1\.5\s*\)\s*calc\(\s*var\(--space\)\s*\*\s*3\s*\)/i.test(
      text,
    ),
    /\.lede\s*\{\s*margin:\s*0 0 calc\(\s*var\(--space\)\s*\*\s*6\s*\)/i.test(text),
  ]);
}

/** Unique Games stub clusters — juice on the same loop still matches. */
function gameStubHits(text: string): number {
  return countTrue([
    /hazards\s*=\s*\[\s*\{\s*x:\s*420/.test(text),
    /fillRect\s*\(\s*x\s*-\s*12\s*,\s*y\s*-\s*24\s*,\s*24\s*,\s*24\s*\)/.test(text),
    /Game over — R restart/.test(text),
    /h\.x\s*-=\s*3\s*\+\s*score\s*\*\s*0\.05/.test(text),
    /vy\s*=\s*-f\.j\s*\*\s*0\.7/.test(text),
    /y\s*>\s*canvas\.height\s*-\s*64/.test(text),
  ]);
}

/** Unique Assets stub clusters — reconstruct on the placeholder hull still matches. */
function assetStubHits(text: string): number {
  return countTrue([
    /function\s+drawPlaceholder\s*\(/.test(text),
    /studio\.paint\s*=\s*drawPlaceholder/.test(text),
    /ellipse\s*\(\s*0\s*,\s*8\s*,\s*72\s*,\s*118/.test(text),
    /verts:\s*new Array\(\s*24\s*\)/.test(text),
    /studio\.yaw\s*\+=\s*0\.012/.test(text),
    /cam\(\)\.zoom\s*\*\s*0\.92/.test(text),
    /placeholder hull until a photo lands/.test(text),
  ]);
}

/**
 * True when finishTurn wrote a fallback stub — including after the model
 * strips `data-locus-host-fallback` or makes a one- or two-token edit and
 * leaves the same Design/Games/Assets body.
 */
export function looksHostFallbackCanvas(html?: string | null): boolean {
  const text = html?.trim() ?? "";
  if (!text) return false;
  if (new RegExp(`\\b${HOST_FALLBACK_ATTR}\\b`, "i").test(text)) return true;
  return designStubHits(text) >= 2 || gameStubHits(text) >= 2 || assetStubHits(text) >= 2;
}
