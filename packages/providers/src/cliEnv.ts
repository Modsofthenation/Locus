/**
 * Names whose spelling suggests a credential. `AUTH` skips `AUTHOR` so Git identity variables
 * (`GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`) survive.
 */
const SECRET_NAME =
  /(TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|API_?KEY|ACCESS_?KEY|CREDENTIAL|PRIVATE_?KEY|AUTH(?!OR)|COOKIE|SESSION|DSN|DATABASE_URL|CONNECTION_STRING)/i;

/** Prefixes of cloud, forge, registry and SaaS tooling variables, which commonly carry credentials. */
const SECRET_PREFIXES = [
  "AWS_",
  "AZURE_",
  "ARM_",
  "GOOGLE_",
  "GCP_",
  "GCLOUD_",
  "CLOUDSDK_",
  "GH_",
  "GITHUB_",
  "GITLAB_",
  "BITBUCKET_",
  "NPM_",
  "NODE_AUTH",
  "DOCKER_",
  "KUBE",
  "VAULT_",
  "OP_",
  "DIGITALOCEAN_",
  "HEROKU_",
  "CLOUDFLARE_",
  "SLACK_",
  "STRIPE_",
  "TWILIO_",
  "SENTRY_",
];

/** Exact names that hand out access (agent sockets, askpass helpers, credential files). */
const SECRET_NAMES = new Set([
  "SSH_AUTH_SOCK",
  "GPG_AGENT_INFO",
  "KUBECONFIG",
  "GIT_ASKPASS",
  "SSH_ASKPASS",
  "NETRC",
]);

/** Prefixes that never hold secrets but would otherwise match `SESSION` (e.g. `XDG_SESSION_TYPE`). */
const KEEP_PREFIXES = ["XDG_"];

/** True when `name` is dropped by {@link scrubCliEnv}. Case-insensitive (Windows env names are). */
export function isSecretEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  if (KEEP_PREFIXES.some((p) => upper.startsWith(p))) return false;
  if (SECRET_NAMES.has(upper)) return true;
  if (SECRET_PREFIXES.some((p) => upper.startsWith(p))) return true;
  return SECRET_NAME.test(upper);
}

/**
 * A copy of `env` without variables likely to hold credentials, for a CLI agent fed untrusted
 * text (e.g. a pull request) that must not be able to echo the server's secrets back.
 *
 * Dropped:
 * - names containing TOKEN, SECRET, PASSWORD, PASSWD, PASSPHRASE, API_KEY / APIKEY,
 *   ACCESS_KEY / ACCESSKEY, CREDENTIAL, PRIVATE_KEY / PRIVATEKEY, AUTH (not AUTHOR), COOKIE,
 *   SESSION, DSN, DATABASE_URL or CONNECTION_STRING (so also DBUS_SESSION_BUS_ADDRESS, which
 *   reaches the desktop keyring);
 * - names starting AWS_, AZURE_, ARM_, GOOGLE_, GCP_, GCLOUD_, CLOUDSDK_, GH_, GITHUB_, GITLAB_,
 *   BITBUCKET_, NPM_, NODE_AUTH, DOCKER_, KUBE, VAULT_, OP_ (1Password), DIGITALOCEAN_, HEROKU_,
 *   CLOUDFLARE_, SLACK_, STRIPE_, TWILIO_, SENTRY_;
 * - exactly SSH_AUTH_SOCK, GPG_AGENT_INFO, KUBECONFIG, GIT_ASKPASS, SSH_ASKPASS, NETRC.
 *
 * Everything else is kept: PATH, HOME (CLIs read their own login from ~/.claude, ~/.codex…),
 * USER, LANG, TERM, TMPDIR, XDG_* (always kept), proxy settings (HTTP_PROXY, HTTPS_PROXY,
 * NO_PROXY), NODE_EXTRA_CA_CERTS, SSL_CERT_FILE, and Windows' APPDATA, LOCALAPPDATA, USERPROFILE,
 * SystemRoot, ComSpec. Matching ignores case. A provider key configured in Locus is added back by
 * each CLI's argv builder after scrubbing; a key only present in the server's environment is not.
 */
export function scrubCliEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    if (!isSecretEnvName(name)) out[name] = value;
  }
  return out;
}
