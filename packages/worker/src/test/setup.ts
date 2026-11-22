// Worker tests drive Docker guests with fake CLI scripts that live in the worker data dir.
// The CLI sandbox has its own tests (cliSandbox.test.ts), which pass `cliSandbox`
// explicitly instead of reading this.
process.env.LOCUS_CLI_SANDBOX = "off";
