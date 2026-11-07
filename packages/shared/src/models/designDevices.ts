import { DESIGN_RECIPES } from "./recipes.js";
import { sessionKind, type SessionKind } from "./session.js";

export interface DesignPhoneDevice {
  id: string;
  label: string;
  width: number;
  height: number;
}

/** CSS viewports for common phones. The canvas iframe lays out at this width and height. */
export const DESIGN_PHONE_DEVICES: DesignPhoneDevice[] = [
  { id: "iphone-se", label: "iPhone SE", width: 375, height: 667 },
  { id: "iphone-15", label: "iPhone 15", width: 390, height: 844 },
  { id: "iphone-16-pro-max", label: "iPhone 16 Pro Max", width: 440, height: 956 },
  { id: "pixel-8", label: "Pixel 8", width: 412, height: 915 },
  { id: "galaxy-s24", label: "Galaxy S24", width: 360, height: 780 },
];

export const DEFAULT_PHONE_DEVICE_ID = "iphone-15";

const MOBILE_RECIPE_ID = "mobile-screen";

/** Mobile-app canvas, not a responsive website that happens to mention phones. */
const MOBILE_CANVAS_RE =
  /\b(mobile\s+(app(lication)?s?|screen|interface|ui)|iphone\s+(app(lication)?s?|screen|ui|mock)|android\s+app|ios\s+app|phone[\s-]?width|native\s+(ios|android|mobile\s+app|app))\b/i;

export function designPhoneDevice(id: string | undefined): DesignPhoneDevice {
  return (
    DESIGN_PHONE_DEVICES.find((row) => row.id === id) ??
    DESIGN_PHONE_DEVICES.find((row) => row.id === DEFAULT_PHONE_DEVICE_ID) ??
    DESIGN_PHONE_DEVICES[0]!
  );
}

export function formatPhoneDeviceCaption(device: DesignPhoneDevice): string {
  return `${device.label} · ${device.width} × ${device.height}`;
}

export function looksLikeMobileCanvasPrompt(text: string): boolean {
  return MOBILE_CANVAS_RE.test(text);
}

export function isMobileDesignSession(session: {
  kind?: SessionKind;
  title?: string;
  messages?: Array<{ role: string; content: string }>;
}): boolean {
  if (sessionKind(session) !== "design") return false;
  const title = (session.title ?? "").trim().toLowerCase();
  const mobileTitle = DESIGN_RECIPES.find(
    (recipe) => recipe.id === MOBILE_RECIPE_ID,
  )?.title.toLowerCase();
  if (mobileTitle && title === mobileTitle) return true;
  const otherTitles = new Set(
    DESIGN_RECIPES.filter((recipe) => recipe.id !== MOBILE_RECIPE_ID).map((recipe) =>
      recipe.title.toLowerCase(),
    ),
  );
  if (otherTitles.has(title)) return false;
  const first = session.messages?.find((message) => message.role === "user")?.content ?? "";
  return looksLikeMobileCanvasPrompt(first);
}
