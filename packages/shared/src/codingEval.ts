/** Score a tiny public coding fixture used as a harness smoke: failing tests in, pass/fail out. */

export interface CodingEvalScore {
  id: string;
  passed: boolean;
  testsRan: boolean;
  testsOk: boolean;
  reason: string;
}

export function scoreCodingEval(input: {
  id: string;
  testsRan: boolean;
  testsOk: boolean;
  source?: string;
  expectSource?: RegExp | string;
}): CodingEvalScore {
  const sourceOk = sourceMatches(input.source, input.expectSource);
  const passed = Boolean(input.testsRan && input.testsOk && sourceOk);
  let reason = "tests passed";
  if (!input.testsRan) reason = "tests did not run";
  else if (!input.testsOk) reason = "tests failed";
  else if (!sourceOk) reason = "source did not match the expected fix";
  return {
    id: input.id,
    passed,
    testsRan: input.testsRan,
    testsOk: input.testsOk,
    reason,
  };
}

function sourceMatches(source: string | undefined, expect?: RegExp | string): boolean {
  if (expect == null) return true;
  const body = source ?? "";
  return typeof expect === "string" ? body.includes(expect) : expect.test(body);
}
