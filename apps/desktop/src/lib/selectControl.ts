/** Test helper: read a native <select> or themed Select value. */
export function selectValue(host: ParentNode, ariaLabel: string): string {
  const trigger = host.querySelector(`[aria-label="${cssEscape(ariaLabel)}"]`);
  if (!trigger) return "";
  if (trigger instanceof HTMLSelectElement) return trigger.value;
  return trigger.closest("[data-value]")?.getAttribute("data-value") ?? "";
}

export function selectOptionValues(host: ParentNode, ariaLabel: string): string[] {
  const trigger = host.querySelector(`[aria-label="${cssEscape(ariaLabel)}"]`);
  if (!trigger) return [];
  if (trigger instanceof HTMLSelectElement) {
    return [...trigger.options].map((opt) => opt.value);
  }
  const menu = trigger.closest("details");
  if (!(trigger instanceof HTMLElement) || !menu) return [];
  if (!menu.open) trigger.click();
  return [...menu.querySelectorAll(".menu-item")]
    .map((el) => el.getAttribute("data-value") ?? "")
    .filter((value, index, all) => all.indexOf(value) === index);
}

export function selectOptionLabels(host: ParentNode, ariaLabel: string): string[] {
  const trigger = host.querySelector(`[aria-label="${cssEscape(ariaLabel)}"]`);
  if (!trigger) return [];
  if (trigger instanceof HTMLSelectElement) {
    return [...trigger.options].map((opt) => opt.textContent ?? "");
  }
  const menu = trigger.closest("details");
  if (!(trigger instanceof HTMLElement) || !menu) return [];
  if (!menu.open) trigger.click();
  return [...menu.querySelectorAll(".menu-item")].map(
    (el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );
}

/** Test helper: set a native <select> or themed Select value. */
export function setSelectValue(host: ParentNode, ariaLabel: string, value: string): boolean {
  const trigger = host.querySelector(`[aria-label="${cssEscape(ariaLabel)}"]`);
  if (!trigger) return false;
  if (trigger instanceof HTMLSelectElement) {
    trigger.value = value;
    trigger.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  const menu = trigger.closest("details");
  if (!(trigger instanceof HTMLElement) || !menu) return false;
  if (!menu.open) trigger.click();
  const item = [...menu.querySelectorAll(".menu-item")].find(
    (el) => el.getAttribute("data-value") === value,
  );
  if (!(item instanceof HTMLElement)) return false;
  item.click();
  return true;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/"/g, '\\"');
}
