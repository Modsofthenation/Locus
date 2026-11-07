import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickReleasesToDelete, pruneGithubReleases } from "./prune-github-releases.mjs";

describe("pickReleasesToDelete", () => {
  it("keeps the newest three published releases", () => {
    const releases = [
      { id: 9, tag_name: "v0.9.0", draft: false },
      { id: 8, tag_name: "v0.8.0", draft: false },
      { id: 7, tag_name: "v0.7.1", draft: false },
      { id: 6, tag_name: "v0.7.0", draft: false },
      { id: 5, tag_name: "v0.6.2", draft: false },
    ];
    assert.deepEqual(
      pickReleasesToDelete(releases, 3).map((row) => row.tag_name),
      ["v0.7.0", "v0.6.2"],
    );
  });

  it("skips drafts when counting the keep window", () => {
    const releases = [
      { id: 1, tag_name: "v-draft", draft: true },
      { id: 2, tag_name: "v0.9.0", draft: false },
      { id: 3, tag_name: "v0.8.0", draft: false },
    ];
    assert.deepEqual(
      pickReleasesToDelete(releases, 2).map((row) => row.tag_name),
      [],
    );
  });

  it("deletes nothing when there are at most keep published releases", () => {
    assert.deepEqual(pickReleasesToDelete([{ id: 1, tag_name: "v0.9.0" }], 3), []);
  });
});

describe("pruneGithubReleases", () => {
  it("DELETEs releases outside the keep window", async () => {
    const deleted = [];
    const calls = [];
    const fetchJson = async (url, _token, method = "GET") => {
      calls.push({ url, method });
      if (method === "DELETE") {
        deleted.push(url);
        return null;
      }
      if (url.includes("page=1")) {
        return [
          { id: 9, tag_name: "v0.9.0", draft: false },
          { id: 8, tag_name: "v0.8.0", draft: false },
          { id: 7, tag_name: "v0.7.1", draft: false },
          { id: 6, tag_name: "v0.7.0", draft: false },
        ];
      }
      return [];
    };
    const result = await pruneGithubReleases({
      keep: 3,
      token: "test-token",
      repo: "Modsofthenation/Locus",
      fetchJson,
    });
    assert.deepEqual(result.deleted, ["v0.7.0"]);
    assert.equal(result.published, 4);
    assert.equal(deleted.length, 1);
    assert.match(deleted[0], /releases\/6$/);
    assert.equal(calls.filter((row) => row.method === "DELETE").length, 1);
  });
});
