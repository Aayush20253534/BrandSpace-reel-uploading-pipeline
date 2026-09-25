import { createHash } from "node:crypto";

export const INSTAGRAM_BUSINESS_LOGIN_SCOPES = [
  "instagram_business_basic",
  "instagram_business_content_publish",
] as const;

export interface InstagramOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  graphVersion: string;
}

export interface InstagramOAuthResult {
  accessToken: string;
  authorizationUserId: string;
  providerAccountId: string;
  username: string;
  displayName: string | null;
  scopes: string[];
  tokenType: string | null;
  expiresInSeconds: number;
}

export interface InstagramTokenRefreshResult {
  accessToken: string;
  tokenType: string | null;
  expiresInSeconds: number;
}

export class InstagramProviderError extends Error {
  readonly httpStatus: number;
  readonly providerCode: number | null;
  readonly providerSubcode: number | null;
  readonly providerType: string | null;

  constructor(
    message: string,
    details: {
      httpStatus: number;
      providerCode?: number | null;
      providerSubcode?: number | null;
      providerType?: string | null;
    },
  ) {
    super(message);
    this.name = "InstagramProviderError";
    this.httpStatus = details.httpStatus;
    this.providerCode = details.providerCode ?? null;
    this.providerSubcode = details.providerSubcode ?? null;
    this.providerType = details.providerType ?? null;
  }
}

export class InstagramAccountMismatchError extends Error {
  constructor() {
    super("Instagram credential resolved to a different professional account");
    this.name = "InstagramAccountMismatchError";
  }
}

type FetchLike = typeof fetch;
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function readJson(response: Response, operation: string) {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // The provider occasionally returns HTML for gateway failures. Keep secrets out
    // of exceptions and expose only the HTTP status in that case.
  }

  if (!response.ok) {
    const providerError =
      isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    const providerMessage = providerError
      ? readString(providerError.message)
      : null;
    const providerCode =
      providerError && typeof providerError.code === "number"
        ? providerError.code
        : null;
    const providerSubcode =
      providerError && typeof providerError.error_subcode === "number"
        ? providerError.error_subcode
        : null;
    const providerType = providerError ? readString(providerError.type) : null;

    throw new InstagramProviderError(
      providerMessage
        ? `${operation} failed (${response.status}): ${providerMessage}`
        : `${operation} failed with HTTP ${response.status}`,
      {
        httpStatus: response.status,
        providerCode,
        providerSubcode,
        providerType,
      },
    );
  }

  if (!isRecord(payload)) {
    throw new Error(`${operation} returned an invalid JSON object`);
  }

  return payload;
}

export function normalizeInstagramGraphVersion(value: string) {
  const version = value.trim();
  if (!/^v\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid Meta Graph API version: ${value}`);
  }
  return version;
}

export function hashInstagramOAuthState(state: string) {
  const normalized = state.trim();
  if (!normalized) throw new Error("Instagram OAuth state must not be empty");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function buildInstagramAuthorizationUrl(
  config: Pick<InstagramOAuthConfig, "appId" | "redirectUri">,
  state: string,
) {
  if (!config.appId.trim()) throw new Error("META_APP_ID is required");
  if (!config.redirectUri.trim()) {
    throw new Error("Instagram OAuth redirect URI is required");
  }

  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", config.appId.trim());
  url.searchParams.set("redirect_uri", config.redirectUri.trim());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", INSTAGRAM_BUSINESS_LOGIN_SCOPES.join(","));
  url.searchParams.set("state", state);
  url.searchParams.set("force_reauth", "true");
  return url;
}

async function exchangeAuthorizationCode(
  config: InstagramOAuthConfig,
  code: string,
  fetchImpl: FetchLike,
) {
  const body = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
    code,
  });

  const response = await fetchImpl(
    "https://api.instagram.com/oauth/access_token",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body,
      cache: "no-store",
    },
  );
  const payload = await readJson(
    response,
    "Instagram authorization-code exchange",
  );

  const accessToken = readString(payload.access_token);
  const userId =
    readString(payload.user_id) ??
    (typeof payload.user_id === "number" ? String(payload.user_id) : null);
  if (!accessToken || !userId) {
    throw new Error(
      "Instagram authorization-code exchange omitted access_token or user_id",
    );
  }

  return { accessToken, userId };
}

async function exchangeLongLivedToken(
  config: InstagramOAuthConfig,
  shortLivedToken: string,
  fetchImpl: FetchLike,
) {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", config.appSecret);
  url.searchParams.set("access_token", shortLivedToken);

  const response = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const payload = await readJson(
    response,
    "Instagram long-lived-token exchange",
  );

  const accessToken = readString(payload.access_token);
  const expiresIn = readNumber(payload.expires_in);
  const tokenType = readString(payload.token_type);
  if (!accessToken || !expiresIn || expiresIn <= 0) {
    throw new Error(
      "Instagram long-lived-token exchange omitted access_token or expires_in",
    );
  }

  return { accessToken, expiresIn, tokenType };
}

export async function refreshInstagramLongLivedToken(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<InstagramTokenRefreshResult> {
  const token = accessToken.trim();
  if (!token) throw new Error("Instagram access token is required");

  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token);

  const response = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const payload = await readJson(response, "Instagram token refresh");

  const refreshedAccessToken = readString(payload.access_token);
  const expiresIn = readNumber(payload.expires_in);
  const tokenType = readString(payload.token_type);
  if (!refreshedAccessToken || !expiresIn || expiresIn <= 0) {
    throw new Error(
      "Instagram token refresh omitted access_token or expires_in",
    );
  }

  return {
    accessToken: refreshedAccessToken,
    tokenType,
    expiresInSeconds: expiresIn,
  };
}

async function fetchProfile(
  graphVersion: string,
  accessToken: string,
  fetchImpl: FetchLike,
) {
  const url = new URL(`https://graph.instagram.com/${graphVersion}/me`);
  url.searchParams.set("fields", "id,user_id,username,name");

  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
    },
    cache: "no-store",
  });
  const raw = await readJson(response, "Instagram profile verification");

  const payload =
    Array.isArray(raw.data) && isRecord(raw.data[0]) ? raw.data[0] : raw;

  const userId =
    readString(payload.user_id) ??
    (typeof payload.user_id === "number" ? String(payload.user_id) : null);
  const appScopedId =
    readString(payload.id) ??
    (typeof payload.id === "number" ? String(payload.id) : null);
  const username = readString(payload.username);
  const name = readString(payload.name);

  if (!userId || !username) {
    throw new Error(
      "Instagram profile verification omitted user_id/id or username",
    );
  }

  return { userId, appScopedId, username, name };
}

export async function verifyInstagramAccessToken(
  graphVersion: string,
  accessToken: string,
  expectedProviderAccountId: string,
  fetchImpl: FetchLike = fetch,
) {
  const expectedId = expectedProviderAccountId.trim();
  if (!expectedId) {
    throw new Error("Expected Instagram provider account id is required");
  }

  const profile = await fetchProfile(
    normalizeInstagramGraphVersion(graphVersion),
    accessToken,
    fetchImpl,
  );
  if (profile.userId !== expectedId) {
    throw new InstagramAccountMismatchError();
  }

  return {
    providerAccountId: profile.userId,
    username: profile.username,
    displayName: profile.name,
  };
}

export function isInstagramReauthenticationError(error: unknown) {
  if (error instanceof InstagramAccountMismatchError) return true;
  if (!(error instanceof InstagramProviderError)) return false;

  return (
    error.httpStatus === 401 ||
    error.providerCode === 190 ||
    error.providerCode === 10 ||
    error.providerCode === 200
  );
}

export function isInstagramTransientProviderError(error: unknown) {
  return (
    error instanceof InstagramProviderError &&
    (error.httpStatus === 429 || error.httpStatus >= 500)
  );
}

export async function completeInstagramOAuth(
  config: InstagramOAuthConfig,
  code: string,
  fetchImpl: FetchLike = fetch,
): Promise<InstagramOAuthResult> {
  const normalizedCode = code.trim();
  if (!normalizedCode) throw new Error("Instagram OAuth code is required");
  if (!config.appId.trim()) throw new Error("META_APP_ID is required");
  if (!config.appSecret.trim()) throw new Error("META_APP_SECRET is required");

  const graphVersion = normalizeInstagramGraphVersion(config.graphVersion);
  const shortLived = await exchangeAuthorizationCode(
    config,
    normalizedCode,
    fetchImpl,
  );
  const longLived = await exchangeLongLivedToken(
    config,
    shortLived.accessToken,
    fetchImpl,
  );
  const profile = await fetchProfile(
    graphVersion,
    longLived.accessToken,
    fetchImpl,
  );

  const verifiedAuthorizationId = profile.appScopedId ?? profile.userId;
  if (verifiedAuthorizationId !== shortLived.userId) {
    throw new Error(
      "Instagram OAuth authorization user does not match the verified profile",
    );
  }

  return {
    accessToken: longLived.accessToken,
    authorizationUserId: shortLived.userId,
    providerAccountId: profile.userId,
    username: profile.username,
    displayName: profile.name,
    scopes: [...INSTAGRAM_BUSINESS_LOGIN_SCOPES],
    tokenType: longLived.tokenType,
    expiresInSeconds: longLived.expiresIn,
  };
}
