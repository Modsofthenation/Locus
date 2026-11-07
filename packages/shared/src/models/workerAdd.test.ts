import { describe, expect, it } from "vitest";
import { formatWorkerAddBlob, parseWorkerAddBlob } from "./workerAdd.js";

const fp = `sha256:${"ab".repeat(32)}`;

describe("worker add blob", () => {
  it("round-trips url, fingerprint, token, and name", () => {
    const blob = formatWorkerAddBlob({
      url: "https://192.168.1.8:7421",
      fingerprint: fp,
      token: "secret-token",
      name: "studio",
    });
    expect(blob.startsWith("locus-worker:add?")).toBe(true);
    expect(parseWorkerAddBlob(blob)).toEqual({
      url: "https://192.168.1.8:7421",
      fingerprint: fp,
      token: "secret-token",
      name: "studio",
    });
  });

  it("omits token when the worker is not printing it again", () => {
    const blob = formatWorkerAddBlob({
      url: "https://10.0.0.4:7421",
      fingerprint: fp,
      name: "box",
    });
    expect(blob).not.toMatch(/token=/);
    expect(parseWorkerAddBlob(blob)).toEqual({
      url: "https://10.0.0.4:7421",
      fingerprint: fp,
      token: undefined,
      name: "box",
    });
  });

  it("fills https and the default port", () => {
    expect(
      parseWorkerAddBlob(`locus-worker:add?url=192.168.1.20&fp=${fp}&token=abc`),
    ).toMatchObject({
      url: "https://192.168.1.20:7421",
      token: "abc",
      fingerprint: fp,
    });
  });

  it("parses a quoted blob and a https URL with query params", () => {
    const blob = formatWorkerAddBlob({
      url: "https://192.168.1.8:7421",
      fingerprint: fp,
      token: "secret",
    });
    expect(parseWorkerAddBlob(`'${blob}'`)).toMatchObject({ token: "secret" });
    expect(parseWorkerAddBlob(`https://10.0.0.9:7421/?fp=${fp}&token=xyz&name=lab`)).toEqual({
      url: "https://10.0.0.9:7421",
      fingerprint: fp,
      token: "xyz",
      name: "lab",
    });
  });

  it("parses labeled lines", () => {
    expect(
      parseWorkerAddBlob(`URL: https://192.168.1.8:7421\nTLS: ${fp}\nToken: once\nName: studio`),
    ).toEqual({
      url: "https://192.168.1.8:7421",
      fingerprint: fp,
      token: "once",
      name: "studio",
    });
  });

  it("rejects junk", () => {
    expect(parseWorkerAddBlob("")).toBeUndefined();
    expect(parseWorkerAddBlob("not a worker")).toBeUndefined();
    expect(parseWorkerAddBlob("locus-worker:add")).toBeUndefined();
  });
});
