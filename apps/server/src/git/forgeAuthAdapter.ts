import { githubAccessTokenUrl, redirectTokenUrl, type ForgeKind } from "@locus/shared";

export type ForgeAuthMethod = "device" | "redirect";

export type ForgeTokenForm = {
  url: string;
  body: Record<string, string>;
  headers: Record<string, string>;
};

const FORM_JSON: Record<string, string> = {
  accept: "application/json",
  "content-type": "application/x-www-form-urlencoded",
};

function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

/** Per-kind OAuth packaging. Sibling to ForgeAdapter — not PR methods. */
export interface ForgeAuthAdapter {
  method: ForgeAuthMethod;
  requiresClientSecret: boolean;
  refreshTokenForm(
    webOrigin: string,
    clientId: string,
    clientSecret: string | undefined,
    refreshToken: string,
  ): ForgeTokenForm;
  exchangeCodeForm(input: {
    origin: string;
    clientId: string;
    clientSecret: string;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): ForgeTokenForm;
  usernameUrl(apiBaseUrl: string): string;
  usernameHeaders(accessToken: string): Record<string, string>;
}

const githubAuth: ForgeAuthAdapter = {
  method: "device",
  requiresClientSecret: false,
  refreshTokenForm(webOrigin, clientId, clientSecret, refreshToken) {
    const body: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    };
    if (clientSecret) body.client_secret = clientSecret;
    return {
      url: githubAccessTokenUrl(webOrigin),
      body,
      headers: { ...FORM_JSON },
    };
  },
  exchangeCodeForm() {
    throw new Error("GitHub sign-in uses device flow");
  },
  usernameUrl(apiBaseUrl) {
    return `${apiBaseUrl.replace(/\/$/, "")}/user`;
  },
  usernameHeaders(accessToken) {
    return {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
    };
  },
};

const gitlabAuth: ForgeAuthAdapter = {
  method: "redirect",
  requiresClientSecret: true,
  refreshTokenForm(webOrigin, clientId, clientSecret, refreshToken) {
    const body: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    };
    if (clientSecret) body.client_secret = clientSecret;
    return {
      url: redirectTokenUrl("gitlab", webOrigin),
      body,
      headers: { ...FORM_JSON },
    };
  },
  exchangeCodeForm(input) {
    return {
      url: redirectTokenUrl("gitlab", input.origin),
      body: {
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
        client_id: input.clientId,
        client_secret: input.clientSecret,
      },
      headers: { ...FORM_JSON },
    };
  },
  usernameUrl(apiBaseUrl) {
    return `${apiBaseUrl.replace(/\/$/, "")}/user`;
  },
  usernameHeaders(accessToken) {
    return {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
    };
  },
};

const bitbucketAuth: ForgeAuthAdapter = {
  method: "redirect",
  requiresClientSecret: true,
  refreshTokenForm(webOrigin, clientId, clientSecret, refreshToken) {
    const headers = { ...FORM_JSON };
    if (clientSecret) headers.authorization = basicAuth(clientId, clientSecret);
    return {
      url: redirectTokenUrl("bitbucket", webOrigin),
      body: {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      },
      headers,
    };
  },
  exchangeCodeForm(input) {
    return {
      url: redirectTokenUrl("bitbucket", input.origin),
      body: {
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.redirectUri,
        code_verifier: input.codeVerifier,
      },
      headers: {
        ...FORM_JSON,
        authorization: basicAuth(input.clientId, input.clientSecret),
      },
    };
  },
  usernameUrl(apiBaseUrl) {
    return `${apiBaseUrl.replace(/\/$/, "")}/user`;
  },
  usernameHeaders(accessToken) {
    return {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
    };
  },
};

export function forgeAuthAdapter(kind: ForgeKind): ForgeAuthAdapter {
  if (kind === "gitlab") return gitlabAuth;
  if (kind === "bitbucket") return bitbucketAuth;
  return githubAuth;
}
