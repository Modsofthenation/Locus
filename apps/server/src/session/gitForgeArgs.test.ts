import { describe, expect, it } from "vitest";
import { fillGitForgeArgs } from "./gitForgeArgs.js";

const bitbucketOrigin = {
  forge: "bitbucket" as const,
  url: "https://bitbucket.org/signiq/signiq8.git",
};

describe("fillGitForgeArgs", () => {
  it("uses a host folder's origin for url and forge (no attached repo)", () => {
    const args = fillGitForgeArgs("git_push", {}, bitbucketOrigin, {
      kind: "bitbucket",
      token: "bb",
    });
    expect(args).toEqual({ token: "bb", forge: "bitbucket", url: bitbucketOrigin.url });
  });

  it("never sends another forge's token", () => {
    const args = fillGitForgeArgs("git_fetch", { ref: "develop" }, bitbucketOrigin, {
      kind: "github",
      token: "ghp_x",
    });
    expect(args.token).toBeUndefined();
    expect(args.forge).toBe("bitbucket");
    expect(args.url).toBe(bitbucketOrigin.url);
  });

  it("keeps explicit args and only adds url for fetch/push", () => {
    expect(
      fillGitForgeArgs(
        "git_push",
        { url: "https://bitbucket.org/a/b.git", token: "t" },
        undefined,
        {
          kind: "github",
          token: "g",
        },
      ),
    ).toEqual({ url: "https://bitbucket.org/a/b.git", token: "t", forge: "bitbucket" });
    expect(
      fillGitForgeArgs("git_status", {}, bitbucketOrigin, { kind: "bitbucket", token: "bb" }).url,
    ).toBeUndefined();
  });
});
