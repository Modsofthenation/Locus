import {
  AUTONOMY_TIERS,
  formatAutonomyHint,
  formatAutonomyShort,
  formatLiveChrome,
  formatNetworkJail,
  formatVision,
  formatWebSearch,
} from "@locus/shared";
import type { SelectOption } from "@/components/layout/Select";

export const JAIL_SELECT_OPTIONS: SelectOption[] = [
  {
    value: "open",
    label: formatNetworkJail("open"),
    hint: "Full internet (needed for first-boot apt)",
  },
  {
    value: "restricted",
    label: formatNetworkJail("restricted"),
    hint: "Forge and providers only",
  },
  { value: "none", label: formatNetworkJail("none"), hint: "No guest internet" },
];

export const AUTONOMY_SELECT_OPTIONS: SelectOption[] = AUTONOMY_TIERS.map((tier) => ({
  value: tier,
  label: formatAutonomyShort(tier),
  hint: formatAutonomyHint(tier),
}));

export const VISION_SELECT_OPTIONS: SelectOption[] = [
  {
    value: "latest",
    label: formatVision("latest"),
    hint: "Model sees the guest after GUI tools",
  },
  { value: "off", label: formatVision("off"), hint: "Text and accessibility trees only" },
];

export const WEB_SEARCH_SELECT_OPTIONS: SelectOption[] = [
  {
    value: "off",
    label: formatWebSearch(false),
    hint: "Model cannot query the public web from the host",
  },
  {
    value: "on",
    label: formatWebSearch(true),
    hint: "Model can call websearch on the host",
  },
];

export const LIVE_CHROME_SELECT_OPTIONS: SelectOption[] = [
  {
    value: "off",
    label: formatLiveChrome(false),
    hint: "Isolated host-chrome profile",
  },
  {
    value: "on",
    label: formatLiveChrome(true),
    hint: "Drive the Chrome tabs already open on this machine",
  },
];

export const OVERLAP_SELECT_OPTIONS: SelectOption[] = [
  { value: "skip", label: "Skip if busy" },
  { value: "coalesce", label: "Run latest when free" },
  { value: "queue", label: "Queue one" },
];

export const ON_OFF_SELECT_OPTIONS: SelectOption[] = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
];
