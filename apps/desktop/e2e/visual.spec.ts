import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const THEMES = ["ember", "paper"] as const;
const SCREENS = [
  "new-agent",
  "new-automation",
  "empty-hero",
  "rail",
  "confirm",
  "prompt",
  "toast",
  "appearance",
  "design-empty",
  "ide-empty",
  "settings-providers",
  "feedback",
  "shortcuts",
  "chat",
  "empty-hint",
  "splitter",
] as const;
const EXTRA_THEMES = ["midnight", "contrast"] as const;
const EXTRA_SCREENS = ["confirm", "appearance"] as const;

function shotTarget(page: Page, screen: (typeof SCREENS)[number]) {
  if (screen === "rail") return page.locator(".side-rail");
  if (screen === "empty-hero" || screen === "design-empty" || screen === "ide-empty") {
    return page.locator(".empty-hero");
  }
  if (screen === "toast") return page.locator(".app-notice");
  if (screen === "appearance") return page.locator(".appearance-layout");
  if (screen === "settings-providers") return page.locator(".settings-page");
  if (screen === "feedback") return page.locator("[data-testid='visual-feedback']");
  if (screen === "shortcuts") return page.locator("[data-testid='palette-shortcuts']");
  if (screen === "chat") return page.locator("[data-testid='visual-chat']");
  if (screen === "empty-hint") return page.locator("[data-testid='visual-empty-hint']");
  if (screen === "splitter") return page.locator("[data-testid='visual-splitter']");
  return page.locator(".modal");
}

async function openScreen(page: Page, screen: string, theme: string) {
  await page.clock.setFixedTime(new Date("2026-03-01T08:00:00.000Z"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/visual.html?screen=${screen}&theme=${theme}`);
  await page.locator("html[data-visual-ready]").waitFor();
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await expect.poll(() => page.evaluate(() => document.fonts.check("16px Outfit"))).toBe(true);
}

test.describe("visual regression", () => {
  for (const theme of THEMES) {
    for (const screen of SCREENS) {
      test(`${screen} ${theme}`, async ({ page }) => {
        await openScreen(page, screen, theme);
        await expect(shotTarget(page, screen)).toHaveScreenshot(`${screen}-${theme}.png`);
      });
    }

    test(`new-automation schedule menu ${theme}`, async ({ page }) => {
      await openScreen(page, "new-automation", theme);
      await page.locator('[aria-label="Schedule"]').click();
      await page.locator(".menu-pop.placed").waitFor();
      await expect(page).toHaveScreenshot(`new-automation-schedule-${theme}.png`);
    });
  }

  for (const theme of EXTRA_THEMES) {
    for (const screen of EXTRA_SCREENS) {
      test(`${screen} ${theme}`, async ({ page }) => {
        await openScreen(page, screen, theme);
        await expect(shotTarget(page, screen)).toHaveScreenshot(`${screen}-${theme}.png`);
      });
    }
  }

  test("see-all themes group by family", async ({ page }) => {
    await openScreen(page, "appearance", "ember");
    await page.getByRole("button", { name: /See all \d+ themes/ }).click();
    await expect(page.locator("[data-testid='theme-family-dark']")).toBeVisible();
    await expect(page.locator("[data-testid='theme-family-light']")).toBeVisible();
    await expect(page.locator("[data-testid='theme-family-contrast']")).toBeVisible();
    await expect(page.locator("[data-testid='theme-family-gradient']")).toBeVisible();
  });

  test("named buttons on feedback and shell screens", async ({ page }) => {
    for (const screen of [
      "confirm",
      "prompt",
      "toast",
      "new-agent",
      "empty-hero",
      "rail",
      "feedback",
      "shortcuts",
      "chat",
      "empty-hint",
      "splitter",
    ] as const) {
      await openScreen(page, screen, "ember");
      const unnamed = await page.locator("button").evaluateAll((buttons) =>
        buttons
          .filter((btn) => {
            const name = (
              btn.getAttribute("aria-label") ||
              btn.getAttribute("title") ||
              btn.textContent ||
              ""
            ).trim();
            return !name;
          })
          .map((btn) => btn.outerHTML.slice(0, 160)),
      );
      expect(unnamed, screen).toEqual([]);
    }
  });

  test("axe on confirm, prompt, feedback, empty hero, shortcuts, chat, empty hint, and splitter", async ({
    page,
  }) => {
    for (const screen of [
      "confirm",
      "prompt",
      "feedback",
      "empty-hero",
      "shortcuts",
      "chat",
      "empty-hint",
      "splitter",
    ] as const) {
      await openScreen(page, screen, "ember");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        .disableRules(["region", "page-has-heading-one", "landmark-one-main", "color-contrast"])
        .analyze();
      expect(
        results.violations,
        `${screen}: ${results.violations.map((row) => row.id).join(", ")}`,
      ).toEqual([]);
    }
  });

  test("busy-dot is near-still with reduced motion", async ({ page }) => {
    await openScreen(page, "feedback", "ember");
    const duration = await page
      .locator(".ui-busy-dot")
      .evaluate((el) => getComputedStyle(el).animationDuration);
    const ms = duration.endsWith("ms")
      ? Number.parseFloat(duration)
      : Number.parseFloat(duration) * 1000;
    expect(ms).toBeLessThan(20);
  });
});

test.describe("visual phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const screen of [
    "confirm",
    "prompt",
    "toast",
    "feedback",
    "shortcuts",
    "empty-hint",
  ] as const) {
    test(`${screen} ember phone`, async ({ page }) => {
      await openScreen(page, screen, "ember");
      await expect(shotTarget(page, screen)).toHaveScreenshot(`${screen}-ember-phone.png`);
    });
  }
});
