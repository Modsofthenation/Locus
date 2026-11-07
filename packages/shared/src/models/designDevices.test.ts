import { describe, expect, it } from "vitest";
import { DESIGN_RECIPES } from "./recipes.js";
import {
  DEFAULT_PHONE_DEVICE_ID,
  DESIGN_PHONE_DEVICES,
  designPhoneDevice,
  formatPhoneDeviceCaption,
  isMobileDesignSession,
  looksLikeMobileCanvasPrompt,
} from "./designDevices.js";

describe("design phone devices", () => {
  it("defaults to iPhone 15 CSS pixels", () => {
    const device = designPhoneDevice(DEFAULT_PHONE_DEVICE_ID);
    expect(device.label).toBe("iPhone 15");
    expect(device.width).toBe(390);
    expect(device.height).toBe(844);
    expect(designPhoneDevice("missing").id).toBe(DEFAULT_PHONE_DEVICE_ID);
    expect(formatPhoneDeviceCaption(device)).toBe("iPhone 15 · 390 × 844");
    expect(new Set(DESIGN_PHONE_DEVICES.map((row) => row.id)).size).toBe(
      DESIGN_PHONE_DEVICES.length,
    );
  });
});

describe("isMobileDesignSession", () => {
  it("treats the Mobile screen recipe as a phone canvas", () => {
    expect(isMobileDesignSession({ kind: "design", title: "Mobile screen", messages: [] })).toBe(
      true,
    );
    expect(isMobileDesignSession({ kind: "design", title: "mobile screen", messages: [] })).toBe(
      true,
    );
  });

  it("keeps other design recipes on Desktop / Tablet / Phone", () => {
    for (const recipe of DESIGN_RECIPES.filter((row) => row.id !== "mobile-screen")) {
      expect(
        isMobileDesignSession({
          kind: "design",
          title: recipe.title,
          messages: [{ role: "user", content: recipe.prompt }],
        }),
      ).toBe(false);
    }
    expect(isMobileDesignSession({ kind: "agent", title: "Mobile screen" })).toBe(false);
  });

  it("detects a freeform mobile-app prompt on an untitled design", () => {
    expect(
      isMobileDesignSession({
        kind: "design",
        title: "Untitled design",
        messages: [{ role: "user", content: "Build a mobile interface for tracking keys" }],
      }),
    ).toBe(true);
    expect(looksLikeMobileCanvasPrompt("Design a mobile app screen at phone width")).toBe(true);
    expect(looksLikeMobileCanvasPrompt("Design an iPhone app for tracking keys")).toBe(true);
    expect(looksLikeMobileCanvasPrompt("Design a landing page for the new iPhone")).toBe(false);
    expect(
      isMobileDesignSession({
        kind: "design",
        title: "Untitled design",
        messages: [{ role: "user", content: "Design a marketing landing page" }],
      }),
    ).toBe(false);
    expect(
      isMobileDesignSession({
        kind: "design",
        title: "Untitled design",
        messages: [{ role: "user", content: "Design a landing page for the new iPhone" }],
      }),
    ).toBe(false);
  });
});
