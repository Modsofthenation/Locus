import { gitTestEnv } from "./gitEnv.js";

Object.assign(process.env, gitTestEnv());
// Session-level tests drive Docker sessions with fake CLI spawners and assert on their
// argv. The sandbox wrapper has its own tests (cliSandbox.test.ts, hostCliTurn.test.ts),
// which pass `env` / `cliSandbox` explicitly instead of reading this.
process.env.LOCUS_CLI_SANDBOX = "off";
