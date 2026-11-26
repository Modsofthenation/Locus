import {
  hexContrast,
  mixHex,
  normalizeThemeHex,
  type CustomTheme,
  type CustomThemeColorKey,
  type CustomThemeExtraColorKey,
} from "@locus/shared";

interface Paint {
  hex: string;
  alpha: number;
}

export interface RenderedContrastIssue {
  label: string;
  ratio: number;
  minimum: number;
  foreground: string;
  background: string;
  fix?: {
    group: "colors" | "extraColors";
    key: CustomThemeColorKey | CustomThemeExtraColorKey;
    color: string;
  };
}

const CLEAR = { hex: "#000000", alpha: 0 };
const COLOR_TOKEN = /rgba?\([^()]+\)|color\(srgb [^()]+\)|#[\da-f]{3,8}\b|\btransparent\b/gi;

function parsePaint(css: string): Paint {
  if (css === "transparent" || !css) return CLEAR;
  const hex = normalizeThemeHex(css);
  if (hex) return { hex, alpha: 1 };
  const isSrgb = css.startsWith("color(srgb ");
  const values = css.match(/-?(?:\d*\.)?\d+%?/g);
  if (!values || values.length < 3) return CLEAR;
  const channels = values.slice(0, 3).map((value) => {
    const channel = Number.parseFloat(value) * (value.endsWith("%") ? 2.55 : isSrgb ? 255 : 1);
    return Math.round(Math.min(255, Math.max(0, channel)))
      .toString(16)
      .padStart(2, "0");
  });
  const alpha = values[3];
  return {
    hex: `#${channels.join("")}`,
    alpha: alpha ? Number.parseFloat(alpha) / (alpha.endsWith("%") ? 100 : 1) : 1,
  };
}

function composite(back: string, front: Paint): string {
  return mixHex(back, front.hex, front.alpha);
}

function imageLayers(value: string): string[] {
  let depth = 0;
  let start = 0;
  const layers: string[] = [];
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "(") depth++;
    else if (value[index] === ")") depth--;
    else if (value[index] === "," && depth === 0) {
      layers.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  layers.push(value.slice(start).trim());
  return layers;
}

/** Sample the computed CSS layers from back to front. Stops, midpoints and
 * overlapping pattern layers cover more than the underlying solid token alone. */
function paintBackground(
  styles: CSSStyleDeclaration,
  under: string[],
  includeImage = true,
): string[] {
  const fill = parsePaint(styles.backgroundColor);
  let paints = [...new Set(under.map((color) => composite(color, fill)))];
  if (!includeImage || !styles.backgroundImage || styles.backgroundImage === "none") return paints;
  for (const layer of imageLayers(styles.backgroundImage).reverse()) {
    const colors = layer.startsWith("url(")
      ? ["#000000", "#808080", "#ffffff"].map((hex) => ({ hex, alpha: 1 }))
      : [...layer.matchAll(COLOR_TOKEN)].map(([token]) => parsePaint(token));
    if (!colors.length) continue;
    const samples = paints.flatMap((background) => {
      const stops = colors.map((color) => composite(background, color));
      return stops.flatMap((stop, index) =>
        index ? [stop, mixHex(stops[index - 1]!, stop, 0.5)] : [stop],
      );
    });
    const unique = [...new Set(samples)];
    const step = Math.max(1, Math.ceil(unique.length / 64));
    paints = unique.filter((_, index) => index % step === 0);
    const last = unique.at(-1);
    if (last && !paints.includes(last)) paints.push(last);
  }
  return paints;
}

function brighten(hex: string, brightness: number): string {
  if (brightness === 1) return hex;
  return `#${(hex.slice(1).match(/.{2}/g) ?? [])
    .map((channel) =>
      Math.round(Math.min(255, parseInt(channel, 16) * brightness))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function suggestion(
  foreground: Paint,
  backgrounds: string[],
  minimum: number,
  brightness: number,
): string | undefined {
  for (let step = 1; step <= 100; step++) {
    for (const toward of ["#000000", "#ffffff"]) {
      const color = mixHex(foreground.hex, toward, step / 100);
      if (
        backgrounds.every(
          (background) => hexContrast(brighten(color, brightness), background) >= minimum,
        )
      )
        return color;
    }
  }
  return undefined;
}

type Sample = {
  selector: string;
  label: string;
  minimum?: number;
  property?: "outlineColor" | "color";
  adjacent?: boolean;
  fix?:
    | { group: "colors"; key: CustomThemeColorKey }
    | { group: "extraColors"; key: CustomThemeExtraColorKey };
};

export function auditThemePreview(root: HTMLElement, theme: CustomTheme): RenderedContrastIssue[] {
  const samples: Sample[] = [
    {
      selector: ".empty-card h2",
      label: "Preview heading",
      fix: { group: "extraColors", key: "heading" },
    },
    {
      selector: ".empty-card .empty-hero h2 + p",
      label: "Muted text on backdrop",
      fix: { group: "colors", key: "muted" },
    },
    {
      selector: "[data-audit-primary]",
      label: "Primary button",
      fix: { group: "colors", key: "accentInk" },
    },
    {
      selector: "[data-theme-audit-hover]",
      label: "Primary button on hover",
      fix: { group: "colors", key: "accentInk" },
    },
    {
      selector: "[data-theme-audit-focus]",
      label: "Keyboard focus ring",
      minimum: 3,
      property: "outlineColor",
      adjacent: true,
      fix: { group: "extraColors", key: "focus" },
    },
    {
      selector: ".theme-audit .sidebar",
      label: "Sidebar text",
      fix: { group: "extraColors", key: "sidebarText" },
    },
    {
      selector: ".theme-audit .user .bubble",
      label: "Your message text",
      fix: { group: "extraColors", key: "userBubbleText" },
    },
    {
      selector: ".theme-audit .assistant .bubble",
      label: "Agent message text",
      fix: { group: "extraColors", key: "assistantBubbleText" },
    },
    {
      selector: ".theme-audit .md-code",
      label: "Code block text",
      fix: { group: "extraColors", key: "codeText" },
    },
    {
      selector: ".theme-audit-terminal",
      label: "Terminal text",
      fix: { group: "extraColors", key: "terminalText" },
    },
    {
      selector: ".theme-audit-cursor",
      label: "Terminal cursor",
      minimum: 3,
      fix: { group: "extraColors", key: "terminalCursor" },
    },
  ];

  const under = new Map<HTMLElement, string[]>();
  function backgrounds(element: HTMLElement): string[] {
    const cached = under.get(element);
    if (cached) return cached;
    const previous =
      element !== root && element.parentElement
        ? backgrounds(element.parentElement)
        : [theme.colors.bg];
    const css = getComputedStyle(element);
    const painted = paintBackground(css, previous, css.backgroundClip !== "text");
    under.set(element, painted);
    return painted;
  }

  const issues: RenderedContrastIssue[] = [];
  for (const sample of samples) {
    const element = root.querySelector<HTMLElement>(sample.selector);
    if (!element) continue;
    const css = getComputedStyle(element);
    const property = sample.property ?? "color";
    const clipped = property === "color" && css.backgroundClip === "text";
    const paints = clipped
      ? [...css.backgroundImage.matchAll(COLOR_TOKEN)].map(([token]) => parsePaint(token))
      : [parsePaint(css[property])];
    if (!paints.some(({ alpha }) => alpha > 0)) continue;

    const adjacent = sample.adjacent ? element.parentElement! : element;
    const brightness = Math.max(0, Number(css.filter.match(/brightness\(([0-9.]+)\)/)?.[1] ?? 1));
    const surfaces = backgrounds(adjacent);
    const minimum = sample.minimum ?? 4.5;
    let worst: RenderedContrastIssue | undefined;
    for (const foreground of paints) {
      for (const surface of surfaces) {
        const color = brighten(composite(surface, foreground), brightness);
        const background = brighten(surface, brightness);
        const ratio = hexContrast(color, background);
        if (ratio >= minimum || (worst && ratio >= worst.ratio)) continue;
        worst = { label: sample.label, ratio, minimum, foreground: color, background };
      }
    }
    if (!worst) continue;

    const target = sample.fix;
    const original = paints[0]!;
    const canFix =
      target && !clipped && (target.key !== "accentInk" || original.hex === theme.colors.accentInk);
    if (canFix) {
      const color = suggestion(
        original,
        surfaces.map((surface) => brighten(surface, brightness)),
        minimum,
        brightness,
      );
      if (color) worst.fix = { ...target, color };
    }
    issues.push(worst);
  }
  return issues;
}
