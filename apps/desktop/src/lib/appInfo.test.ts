import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  APP_COPYRIGHT,
  APP_DEVELOPER,
  APP_LICENSE,
  APP_LICENSE_TEXT,
  APP_NAME,
  APP_RELEASES_URL,
  APP_VERSION,
} from "./appInfo";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "../../package.json"), "utf8")) as {
  version: string;
};
const license = readFileSync(join(here, "../../../../LICENSE"), "utf8");

describe("appInfo", () => {
  it("matches the desktop package version", () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("credits the developer and MIT license", () => {
    expect(APP_NAME).toBe("Locus");
    expect(APP_DEVELOPER).toBe("Damon Van Der Linde");
    expect(APP_LICENSE).toBe("MIT License");
    expect(APP_RELEASES_URL).toBe("https://github.com/Modsofthenation/Locus/releases");
  });

  it("shows the repo LICENSE file, including its copyright line", () => {
    expect(APP_LICENSE_TEXT).toBe(license.trimEnd());
    expect(APP_COPYRIGHT).toBe("Copyright (c) 2026 Locus contributors");
    expect(APP_LICENSE_TEXT).toContain(APP_COPYRIGHT);
  });
});
