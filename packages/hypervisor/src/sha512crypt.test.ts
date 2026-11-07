import { describe, expect, it } from "vitest";
import { sha512Crypt } from "./sha512crypt.js";

describe("sha512Crypt", () => {
  it("matches openssl passwd -6 for the locus test vector", () => {
    expect(sha512Crypt("locus", "locussalt")).toBe(
      "$6$locussalt$5W5eQmmkWTs2oPVIAOZz/jYD4kZD9zh4QgLVO6Aq575FiNSwPuzPj81Dyq6CFGggWOcAHmnkViEqWWiYNnx.50",
    );
  });
});
