(() => {
  const MAX_SNAPSHOT = 8000;
  const INTERACTIVE = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "OPTION"]);

  let refs = new Map();

  function showBanner(on) {
    let el = document.getElementById("locus-live-chrome-banner");
    if (!on) {
      if (el) el.hidden = true;
      return;
    }
    if (!el) {
      el = document.createElement("div");
      el.id = "locus-live-chrome-banner";
      el.textContent = "Locus is using this tab";
      document.documentElement.appendChild(el);
    }
    el.hidden = false;
  }

  function visible(el) {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2;
  }

  function roleOf(el) {
    const role = el.getAttribute("role");
    if (role) return role;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "submit" || type === "button") return "button";
      return "textbox";
    }
    return tag;
  }

  function nameOf(el) {
    if (el instanceof HTMLInputElement && el.type === "password") return "";
    const labelled = el.getAttribute("aria-label") || el.getAttribute("placeholder") || "";
    const text = (el.innerText || el.textContent || labelled || el.getAttribute("name") || "")
      .replace(/\s+/g, " ")
      .replace(/"/g, "'")
      .trim();
    return text.slice(0, 80);
  }

  function collect() {
    refs = new Map();
    const lines = [];
    let used = 0;
    let index = 0;
    const nodes = document.querySelectorAll(
      "a, button, input, select, textarea, summary, [role], [contenteditable='true']",
    );
    for (const el of nodes) {
      if (!visible(el)) continue;
      if (!INTERACTIVE.has(el.tagName) && !el.getAttribute("role") && !el.isContentEditable) {
        continue;
      }
      index += 1;
      const ref = `@e${index}`;
      refs.set(ref, el);
      el.setAttribute("data-locus-ref", ref.slice(1));
      const name = nameOf(el);
      const line = name ? `${ref} ${roleOf(el)} "${name}"` : `${ref} ${roleOf(el)}`;
      if (used + line.length + (lines.length ? 1 : 0) > MAX_SNAPSHOT) break;
      lines.push(line);
      used += line.length + (lines.length > 1 ? 1 : 0);
    }
    return {
      ok: true,
      output: lines.join("\n") || "(empty page)",
    };
  }

  function resolve(ref) {
    const key = String(ref || "").startsWith("@") ? String(ref) : `@${ref}`;
    return refs.get(key) || document.querySelector(`[data-locus-ref="${key.slice(1)}"]`);
  }

  function clickRef(ref) {
    const el = resolve(ref);
    if (!el) return { ok: false, output: `unknown ref ${ref}` };
    el.scrollIntoView({ block: "center", inline: "nearest" });
    if (el instanceof HTMLElement) el.focus();
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    if (typeof el.click === "function") el.click();
    return { ok: true, output: `clicked ${ref}` };
  }

  function typeRef(ref, text) {
    const clicked = clickRef(ref);
    if (!clicked.ok) return clicked;
    const el = resolve(ref);
    if (!el) return { ok: false, output: `unknown ref ${ref}` };
    if (el instanceof HTMLInputElement && el.type === "password") {
      el.value = String(text ?? "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, output: `typed into ${ref}` };
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = String(text ?? "");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, output: `typed into ${ref}` };
    }
    document.execCommand("insertText", false, String(text ?? ""));
    return { ok: true, output: `typed into ${ref}` };
  }

  function mouseAt(kind, x, y, extra = {}) {
    const target = document.elementFromPoint(x, y) || document.body;
    const type =
      kind === "mousePressed"
        ? "mousedown"
        : kind === "mouseReleased"
          ? "mouseup"
          : kind === "mouseWheel"
            ? "wheel"
            : "mousemove";
    const init = {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      view: window,
      button: extra.button === "right" ? 2 : extra.button === "middle" ? 1 : 0,
      detail: extra.clickCount || 1,
    };
    if (type === "wheel") {
      target.dispatchEvent(
        new WheelEvent("wheel", { ...init, deltaX: extra.deltaX || 0, deltaY: extra.deltaY || 0 }),
      );
    } else {
      target.dispatchEvent(new MouseEvent(type, init));
    }
    if (kind === "mouseReleased") {
      target.dispatchEvent(new MouseEvent("click", init));
    }
    return { ok: true, output: `${kind} ${Math.round(x)},${Math.round(y)}` };
  }

  function insertText(text) {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const start = el.selectionStart ?? el.value.length;
      el.setRangeText(String(text ?? ""), start, el.selectionEnd ?? start, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: true, output: "type_text" };
    }
    document.execCommand("insertText", false, String(text ?? ""));
    return { ok: true, output: "type_text" };
  }

  function key(kind, keyName) {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent(kind === "keyUp" ? "keyup" : "keydown", {
        key: keyName,
        bubbles: true,
        cancelable: true,
      }),
    );
    return { ok: true, output: `key ${keyName}` };
  }

  function consoleLog() {
    const errors = (window.__locusErrors || []).slice(-40);
    const nav = performance.getEntriesByType("navigation").map((row) => row.name);
    return { ok: true, output: JSON.stringify({ errors, nav }).slice(0, 8000) };
  }

  function networkLog() {
    const rows = performance
      .getEntriesByType("resource")
      .slice(-40)
      .map((entry) => ({
        name: entry.name,
        dur: Math.round(entry.duration),
        type: entry.initiatorType,
      }));
    return { ok: true, output: JSON.stringify(rows).slice(0, 8000) };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    try {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "banner") {
        showBanner(Boolean(msg.on));
        sendResponse({ ok: true, output: "banner" });
        return;
      }
      if (msg.type === "snapshot") {
        sendResponse(collect());
        return;
      }
      if (msg.type === "click") {
        sendResponse(clickRef(msg.ref));
        return;
      }
      if (msg.type === "type") {
        sendResponse(typeRef(msg.ref, msg.text));
        return;
      }
      if (msg.type === "mouse") {
        sendResponse(mouseAt(msg.kind, Number(msg.x) || 0, Number(msg.y) || 0, msg));
        return;
      }
      if (msg.type === "insertText") {
        sendResponse(insertText(msg.text));
        return;
      }
      if (msg.type === "key") {
        sendResponse(key(msg.kind, msg.key));
        return;
      }
      if (msg.type === "console") {
        sendResponse(consoleLog());
        return;
      }
      if (msg.type === "network") {
        sendResponse(networkLog());
        return;
      }
    } catch (err) {
      sendResponse({ ok: false, output: err instanceof Error ? err.message : "content failed" });
    }
    return true;
  });
})();
