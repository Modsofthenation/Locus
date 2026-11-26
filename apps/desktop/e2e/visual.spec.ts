import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const THEMES = ["ember", "paper"] as const;
const SCREENS = [
  "new-agent",
  "new-automation",
  "empty-hero",
  "rail",
  "sidebar",
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
  if (screen === "sidebar") return page.locator(".sidebar");
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
      await page.locator('[aria-label="Schedule"], [aria-label^="Schedule: "]').click();
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

  test("reviews keeps activity, setup, and troubleshooting in separate views", async ({ page }) => {
    await openScreen(page, "reviews", "ember");
    const activity = page.getByRole("region", { name: "Review activity" });
    const reviewers = page.getByRole("region", { name: "Slack reviewers" });
    const diagnostics = page.getByRole("region", { name: "Review diagnostics" });
    const nav = page.getByRole("navigation", { name: "Reviews" });

    await expect(activity.getByRole("link", { name: "acme/api#490" })).toBeVisible();
    await expect(reviewers).toBeHidden();
    await expect(diagnostics).toBeHidden();

    await nav.getByRole("button", { name: "Reviewers" }).click();
    await expect(activity).toBeHidden();
    await expect(reviewers.getByRole("button", { name: "Add reviewer" })).toBeVisible();
    await expect(
      reviewers
        .getByTestId("slack-reviewer-r1")
        .getByRole("button", { name: "Run now", exact: true }),
    ).toBeVisible();
    await reviewers.getByRole("button", { name: /^API reviews/ }).click();
    await expect(reviewers.getByRole("button", { name: "Review now" })).toBeVisible();
    await expect(reviewers.getByText("Triggers and filters", { exact: true })).toBeVisible();
    await expect(reviewers.getByText("Skip draft PRs", { exact: true })).toBeHidden();
    await reviewers.getByText("Triggers and filters", { exact: true }).click();
    await expect(reviewers.getByText("Skip draft PRs", { exact: true })).toBeVisible();

    await nav.getByRole("button", { name: "Diagnostics" }).click();
    await expect(reviewers).toBeHidden();
    await expect(diagnostics.getByText(/^Polling · Fixed/)).toBeVisible();
    await expect(diagnostics.getByText("Live logs", { exact: true })).toBeVisible();
  });

  test("More keeps the focused section visible on a short window", async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 460 });
    await openScreen(page, "rail", "ember");
    const trigger = page.locator(".rail-more summary");
    await trigger.focus();
    await page.keyboard.press("ArrowDown");

    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Switch to Lite UI" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem", { name: /^IDE/ })).toBeFocused();
    await page.keyboard.press("End");
    const docker = menu.getByRole("menuitem", { name: /^Docker/ });
    await expect(docker).toBeFocused();
    await expect(docker).toBeInViewport({ ratio: 1 });
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("see-all themes group by family", async ({ page }) => {
    await openScreen(page, "appearance", "ember");
    await page.getByRole("button", { name: /See all \d+ themes/ }).click();
    await expect(page.locator("[data-testid='theme-family-dark']")).toBeVisible();
    await expect(page.locator("[data-testid='theme-family-light']")).toBeVisible();
    await expect(page.locator("[data-testid='theme-family-contrast']")).toBeVisible();
    await expect(page.locator("[data-testid='theme-family-gradient']")).toBeVisible();
  });

  test("style filters preview and apply the new themes", async ({ page }) => {
    await openScreen(page, "appearance-generated", "ember");
    const root = page.locator("html");
    const preview = page.locator(".theme-preview");

    await page.getByTestId("theme-filter-textile").click();
    await expect(page.locator(".theme-card")).toHaveCount(3);
    await page.getByRole("button", { name: /^Selvedge/ }).click();
    await expect(root).toHaveAttribute("data-theme", "selvedge");
    await expect(root).toHaveCSS("color-scheme", "dark");

    await page.getByTestId("theme-filter-porcelain").click();
    await expect(page.locator(".theme-card")).toHaveCount(3);
    const delft = page.getByRole("button", { name: /^Delft/ });
    await delft.focus();
    await expect(preview).toHaveAttribute("data-theme", "delft");
    await expect(preview.locator(".empty-composer")).toHaveCSS("border-top-style", "double");
    await expect(root).toHaveAttribute("data-theme-style", "textile");

    await delft.press("Enter");
    await expect(root).toHaveAttribute("data-theme-style", "porcelain");
    await expect(root).toHaveCSS("color-scheme", "light");
    await expect(delft).toHaveAttribute("aria-pressed", "true");
  });

  test("mixes styles, audits rendered contrast, and applies only on save", async ({ page }) => {
    await openScreen(page, "appearance-generated", "ember");
    const root = page.locator("html");
    const applied = await root.getAttribute("data-theme");
    await page.getByTestId("theme-filter-generated").click();
    await page.getByTestId("theme-new").click();
    const preview = page.getByTestId("theme-preview");
    await page.getByLabel("Component style").selectOption("porcelain");
    await page.getByLabel("Palette", { exact: true }).selectOption("nightbus");
    await page.getByLabel("Typography preset").selectOption("terminal");
    await page.getByLabel("Muted text", { exact: true }).fill("#9a9a9a");
    await page.getByLabel("Backdrop", { exact: true }).selectOption("gradient");
    await page.getByLabel("Strength", { exact: true }).press("End");
    const backdropPair = page.getByRole("listitem").filter({ hasText: "Muted text on backdrop" });
    await expect(preview).toHaveCSS("background-image", /linear-gradient/);
    await expect(backdropPair).toContainText("needs 4.5:1");

    await page.getByLabel("Effects preset").selectOption("quiet");
    await expect(backdropPair).toHaveCount(0);
    await expect(preview).toHaveAttribute("data-theme-style", "porcelain");
    await expect(preview).toHaveCSS("background-color", "rgb(17, 22, 25)");
    await expect(preview.locator(".empty-composer")).toHaveCSS("border-top-style", "double");
    await expect(preview.locator("h2")).toHaveCSS("font-family", /IBM Plex Mono/);
    await expect(root).toHaveAttribute("data-theme", applied!);
    await expect(preview.locator(".theme-preview-stage")).toHaveCSS("background-image", "none");

    await page.getByLabel("Text on accent", { exact: true }).fill("#f8dd58");
    await expect(
      page.getByRole("listitem").filter({ hasText: "Primary button on hover" }),
    ).toContainText("1.00:1");
    await page.getByLabel("Focus ring", { exact: true }).first().fill("#111619");
    await expect(
      page.getByRole("listitem").filter({ hasText: "Keyboard focus ring" }),
    ).toContainText("1.00:1");

    await page.getByLabel("Terminal background", { exact: true }).fill("#112233");
    await page.getByLabel("Terminal text", { exact: true }).fill("#112233");
    const terminal = page.getByRole("listitem").filter({ hasText: "Terminal text" });
    await expect(terminal).toContainText("1.00:1");
    await terminal.getByRole("button", { name: /Use #/ }).click();
    await expect(terminal).toHaveCount(0);

    await page.getByLabel("Effects preset").selectOption("style");
    await page.getByLabel(/Add a PNG, JPEG, or WebP/).setInputFiles({
      name: "backdrop.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMkoAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(preview).toHaveCSS("background-image", /data:image\/png/);

    await page.getByTestId("theme-editor-save").click();
    await expect(root).toHaveAttribute("data-theme", "custom-my-theme");
    await expect(root).toHaveAttribute("data-theme-style", "porcelain");
    await expect(root).toHaveCSS("color-scheme", "dark");
    await expect(root).toHaveCSS("background-image", /data:image\/png/);
    const thumbnail = page.locator('.theme-thumb[data-theme="custom-my-theme"]');
    await expect(thumbnail).toHaveCSS("background-color", "rgb(17, 22, 25)");
    await expect(thumbnail).toHaveCSS("background-image", /data:image\/png/);
    await page.getByRole("button", { name: "Edit My theme" }).click();
    await page.getByLabel("Palette", { exact: true }).selectOption("paper");
    await expect(preview).toHaveCSS("color-scheme", "light");
    await expect(root).toHaveCSS("color-scheme", "dark");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  });

  test("follows system appearance and previews pack variants before installing", async ({
    page,
  }) => {
    await openScreen(page, "appearance-generated", "ember");
    const root = page.locator("html");
    await page.getByText("Automatic themes and workspace accents", { exact: true }).click();
    await page.getByLabel("Light theme").selectOption("delft");
    await page.getByLabel("Dark theme").selectOption("nightbus");
    await page.getByLabel("Follow system appearance").check();
    await expect(root).toHaveAttribute("data-theme", "nightbus");
    await page.emulateMedia({ colorScheme: "light" });
    await expect(root).toHaveAttribute("data-theme", "delft");
    await page.getByLabel("Workspace", { exact: true }).selectOption("project:example");
    await page.getByLabel("Workspace accent").fill("#406080");
    await expect(root).toHaveAttribute("data-workspace-accent");
    await expect(root).toHaveCSS("--workspace-accent", "#406080");
    await page.getByRole("button", { name: "Clear accent" }).click();
    await expect(root).not.toHaveAttribute("data-workspace-accent");

    await page.getByTestId("theme-filter-generated").click();
    await page.getByText("Import and export theme packs", { exact: true }).click();
    await page.getByLabel("Or paste theme JSON").fill(
      JSON.stringify({
        format: "locus-theme-pack",
        version: 1,
        name: "Dawn and dusk",
        variants: [
          { name: "Dawn Variant", scheme: "light", base: "cartography" },
          { name: "Dusk Variant", scheme: "dark", base: "textile" },
        ],
      }),
    );
    await page.getByRole("button", { name: "Preview import" }).click();
    await page.getByLabel("Preview variant").selectOption("1");
    await expect(page.getByTestId("theme-preview")).toHaveAttribute("data-theme-style", "textile");
    await expect(root).toHaveAttribute("data-theme", "delft");
    await expect(page.getByRole("button", { name: /^Dusk Variant/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Install 2 variants" }).click();
    await expect(page.getByRole("button", { name: /^Dusk Variant/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Dawn Variant/ })).toBeVisible();
    await expect(root).toHaveAttribute("data-theme", "delft");

    const pack = page.locator(".theme-pack");
    await pack.getByLabel("Dawn Variant (light)").check();
    await pack.getByLabel("Dusk Variant (dark)").check();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export selected variants" }).click();
    expect((await download).suggestedFilename()).toBe("locus-theme-pack.json");
  });

  test("named buttons on feedback and shell screens", async ({ page }) => {
    for (const screen of [
      "confirm",
      "prompt",
      "toast",
      "new-agent",
      "empty-hero",
      "rail",
      "sidebar",
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

  for (const saved of [340, 480]) {
    test(`sidebar (${saved}px saved) never runs under the workspace on narrow windows`, async ({
      page,
    }) => {
      await page.addInitScript((width) => {
        localStorage.setItem("locus.sidebarPrefs", JSON.stringify({ width }));
      }, saved);
      for (const width of [1440, 1094, 900, 800, 700]) {
        await page.setViewportSize({ width, height: 800 });
        await openScreen(page, "sidebar", "ember");
        const box = await page.evaluate(() => {
          const app = document.querySelector(".app");
          const side = app?.children[0]?.getBoundingClientRect();
          const work = app?.children[1]?.getBoundingClientRect();
          return { side: side?.right ?? 0, work: work?.left ?? 0 };
        });
        expect(box.side, `viewport ${width}px`).toBeLessThanOrEqual(box.work + 1);
      }
    });
  }
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
