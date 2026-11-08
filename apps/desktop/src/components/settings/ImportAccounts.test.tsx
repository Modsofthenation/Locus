import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ForgeImportAccount, ForgeRepoHint } from "@locus/shared";
import { ImportAccounts } from "./ImportAccounts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const accounts: ForgeImportAccount[] = [
  {
    accountId: "gh1",
    accountName: "Ada (Locus)",
    kind: "github",
    repos: [
      {
        forge: "github",
        accountId: "gh1",
        accountName: "Ada (Locus)",
        owner: "Modsofthenation",
        name: "Locus",
        url: "https://github.com/Modsofthenation/Locus.git",
        private: true,
      },
      {
        forge: "github",
        accountId: "gh1",
        accountName: "Ada (Locus)",
        owner: "Modsofthenation",
        name: "docs-site",
        url: "https://github.com/Modsofthenation/docs-site.git",
      },
      {
        forge: "github",
        accountId: "gh1",
        accountName: "Ada (Locus)",
        owner: "acme",
        name: "app",
        url: "https://github.com/acme/app.git",
        private: true,
      },
    ],
  },
];

describe("ImportAccounts", () => {
  let host: HTMLDivElement;
  let root: Root;

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function render(
    extra: Partial<Parameters<typeof ImportAccounts>[0]> = {},
    onLink: (hints: ForgeRepoHint[]) => void = () => undefined,
  ) {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(<ImportAccounts accounts={accounts} onLink={onLink} {...extra} />);
    });
  }

  function typeSearch(value: string) {
    const input = host.querySelector("[aria-label='Search repositories']") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  it("groups repositories by owner and shows a private chip", () => {
    render();
    expect(host.querySelector("[data-testid='import-accounts']")).toBeTruthy();
    expect(host.querySelector(".import-search")?.getAttribute("placeholder")).toBe(
      "Search repositories",
    );
    expect(host.querySelector(".search-icon svg")).toBeTruthy();
    expect([...host.querySelectorAll(".import-owner-name")].map((el) => el.textContent)).toEqual([
      "Modsofthenation",
      "acme",
    ]);
    expect(host.querySelector("[aria-label='Modsofthenation/Locus']")).toBeTruthy();
    expect(host.textContent).toContain("Locus");
    expect(host.textContent).not.toContain("Modsofthenation/Locus");
    expect(host.querySelector(".import-private")?.textContent).toMatch(/private/);
    expect(host.textContent).toContain("3 repositories");
    expect(host.querySelector(".forge-badge")?.textContent).toBe("GitHub");
  });

  it("filters by search and visibility", () => {
    render();
    act(() => {
      typeSearch("docs");
    });
    expect(host.querySelector("[aria-label='Modsofthenation/docs-site']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Modsofthenation/Locus']")).toBeNull();
    expect(host.textContent).toContain("1 of 3");

    act(() => {
      typeSearch("");
    });
    act(() => {
      (
        [...host.querySelectorAll(".import-filters button")].find(
          (btn) => btn.textContent === "Private",
        ) as HTMLButtonElement
      ).click();
    });
    expect(host.querySelector("[aria-label='Modsofthenation/Locus']")).toBeTruthy();
    expect(host.querySelector("[aria-label='acme/app']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Modsofthenation/docs-site']")).toBeNull();

    act(() => {
      (
        [...host.querySelectorAll(".import-filters button")].find(
          (btn) => btn.textContent === "Public",
        ) as HTMLButtonElement
      ).click();
    });
    expect(host.querySelector("[aria-label='Modsofthenation/docs-site']")).toBeTruthy();
    expect(host.querySelector("[aria-label='Modsofthenation/Locus']")).toBeNull();

    act(() => {
      typeSearch("zzz");
    });
    expect(host.textContent).toContain("No matching repositories.");
  });

  it("selects all visible unlinked repos and links them", () => {
    const onLink = vi.fn();
    render({ linkedUrls: ["https://github.com/acme/app.git"] }, onLink);
    expect(host.querySelector(".import-row.linked")?.textContent).toContain("app");
    expect(host.querySelector(".import-linked")?.textContent).toBe("Linked");
    const linkedBox = host.querySelector("[aria-label='acme/app']") as HTMLInputElement;
    expect(linkedBox.disabled).toBe(true);
    expect(linkedBox.checked).toBe(true);

    act(() => {
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Select all")!.click();
    });
    expect(host.querySelector(".btn.primary")?.textContent).toBe("Link selected (2)");
    expect(
      (host.querySelector("[aria-label='Modsofthenation/Locus']") as HTMLInputElement).checked,
    ).toBe(true);
    expect(linkedBox.checked).toBe(true);

    act(() => {
      (host.querySelector(".btn.primary") as HTMLButtonElement).click();
    });
    expect(onLink).toHaveBeenCalledTimes(1);
    expect(onLink.mock.calls[0]![0].map((row: ForgeRepoHint) => row.name)).toEqual([
      "Locus",
      "docs-site",
    ]);
  });

  it("selects one owner group and ignores already linked rows", () => {
    const onLink = vi.fn();
    render({ linkedUrls: ["https://github.com/Modsofthenation/Locus"] }, onLink);
    const owner = [...host.querySelectorAll(".import-owner")].find((el) =>
      el.textContent?.includes("Modsofthenation"),
    );
    act(() => {
      [...owner!.querySelectorAll("button")].find((btn) => btn.textContent === "Select")!.click();
    });
    expect(host.querySelector(".btn.primary")?.textContent).toBe("Link selected (1)");
    act(() => {
      (host.querySelector(".btn.primary") as HTMLButtonElement).click();
    });
    expect(onLink.mock.calls[0]![0].map((row: ForgeRepoHint) => row.name)).toEqual(["docs-site"]);
  });

  it("shows a loading skeleton", () => {
    render({ loading: true, accounts: [] });
    expect(host.querySelector("[data-testid='import-skeleton']")).toBeTruthy();
    expect(host.querySelector(".import-search")).toBeNull();
  });

  it("dismisses the picker and opens git settings on an auth error", () => {
    const onDismiss = vi.fn();
    const onOpenGitSettings = vi.fn();
    render({
      onDismiss,
      onOpenGitSettings,
      accounts: [
        {
          accountId: "gh1",
          accountName: "Ada (Locus)",
          kind: "github",
          error:
            '{"type": "error", "error": {"message": "Token is invalid, expired, or not supported for this endpoint."}}',
          repos: [],
        },
      ],
    });
    expect(host.querySelector(".error-row")?.textContent).toContain("Token is invalid");
    act(() => {
      [...host.querySelectorAll("button")]
        .find((btn) => btn.textContent === "Open Git settings")!
        .click();
    });
    expect(onOpenGitSettings).toHaveBeenCalled();
    act(() => {
      [...host.querySelectorAll("button")].find((btn) => btn.textContent === "Cancel")!.click();
    });
    expect(onDismiss).toHaveBeenCalled();
  });
});
