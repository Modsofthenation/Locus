# Managed policy

An admin can lock Locus with a policy file the operator cannot override in Settings.

## Where it lives

Locus reads the first file that parses:

1. `LOCUS_POLICY_PATH` — unsigned JSON (admin override / tests)
2. `/etc/locus/policy.json` — unsigned machine policy
3. `~/.locus/policy.json` — only if HMAC-SHA256 of the file body matches `~/.locus/policy.json.sig`

The HMAC key is `LOCUS_POLICY_KEY`, else `/etc/locus/policy.key` (mode `0600`, root). A key in `~/.locus/policy.key` is **ignored** so the operator cannot self-sign a permissive policy. `LOCUS_POLICY_KEY` is an admin/test override (launchd, systemd, MDM); do not put it in a user-writable shell rc. Policy is applied at load time and **never written** to `config.json`. For a real lockdown drop unsigned `/etc/locus/policy.json` (no key needed) or sign `~/.locus/policy.json` with `/etc/locus/policy.key`.

## What a profile locks

`name` is optional. When it is omitted, Settings shows **Managed by organization policy**. A typical file:

```json
{
  "version": 1,
  "allowedProviders": ["anthropic", "openai", "bedrock", "ollama"],
  "blockConsumerLogins": true,
  "blockArbitraryBaseUrls": true,
  "brainDistillerProvider": "anthropic",
  "sandbox": {
    "allowHostAgents": false,
    "allowHostMcp": false,
    "allowHostAutomations": false,
    "allowLiveChrome": false,
    "allowPhoneRemote": false,
    "allowAutonomous": false,
    "defaultJail": "restricted",
    "forceJail": true
  },
  "gifLookup": false,
  "tokenFreeMode": false,
  "tokenScope": "warn",
  "defaultDenyEgress": true
}
```

- **Providers.** Only Anthropic API, OpenAI API, Bedrock, and Ollama stay enabled. Cursor / Claude Code / Codex / Kiro consumer logins and arbitrary OpenAI-compatible `baseUrl`s are disabled.
- **Brain.** Distiller is pinned to an allowed provider. `"allowedProviders": []` means no LLM distiller — local heuristics only.
- **Sandbox.** Host agents, host MCP, host automations, Use my Chrome, phone remote, and Autonomous are off. Guest jail is restricted (or none).
- **GIF lookup.** Slack GIF search stays on the local catalog unless `gifLookup` is true.
- **Tokens.** `tokenScope: warn|block` checks JWT write/admin scopes at save. `tokenFreeMode` plus `integrationProxyUrl` injects a managed MCP proxy and refuses personal tokens in the vault.

Settings shows a **Managed by organization policy** banner (or **Managed by {name} policy** when `name` is set); locked controls are greyed out.

## Guest jail

Every guest defaults to **restricted** (forge + approved provider allowlist, logged CONNECT). Docker OUTPUT is default-deny except loopback, Docker DNS (`127.0.0.11`), and the host proxy. Operators can still pick Open unless the policy sets `forceJail`.

## Audit

Per session (loopback-only, same as `/api/debug/logs*` — a paired LAN phone gets 403):

- `GET /api/sessions/:id/audit/egress` — hosts contacted, allow/deny counts, bytes sent
- `GET /api/sessions/:id/audit/approvals` — push / PR / MCP / integration writes (who, when, decision)
- `GET /api/audit/approvals` — same export across sessions

CLI: `locus config policy`, `locus config revoke-all --confirm REVOKE`, `locus debug egress <id>`, `locus debug approvals [id]`.
