import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInstagramAuthorizationUrl,
  completeInstagramOAuth,
  hashInstagramOAuthState,
  INSTAGRAM_BUSINESS_LOGIN_SCOPES,
  normalizeInstagramGraphVersion,
} from "./instagram";

const config = {
  appId: "123456789",
  appSecret: "meta-secret",
  redirectUri: "https://forge.example/api/social/instagram/callback",
  graphVersion: "v26.0",
};

test("Instagram authorization URL carries exact redirect, state and minimal publishing scopes", () => {
  const url = buildInstagramAuthorizationUrl(config, "state-value");

  assert.equal(url.origin, "https://www.instagram.com");
  assert.equal(url.pathname, "/oauth/authorize");
  assert.equal(url.searchParams.get("client_id"), config.appId);
  assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.deepEqual(url.searchParams.get("scope")?.split(","), [
    ...INSTAGRAM_BUSINESS_LOGIN_SCOPES,
  ]);
});

test("OAuth state hashes are deterministic without persisting the browser nonce", () => {
  assert.equal(
    hashInstagramOAuthState("state-value"),
    hashInstagramOAuthState("state-value"),
  );
  assert.notEqual(
    hashInstagramOAuthState("state-value"),
    hashInstagramOAuthState("other-state"),
  );
});

test("Graph version validation rejects unpinned or malformed versions", () => {
  assert.equal(normalizeInstagramGraphVersion("v26.0"), "v26.0");
  assert.throws(() => normalizeInstagramGraphVersion("latest"));
  assert.throws(() => normalizeInstagramGraphVersion("26"));
});

test("OAuth completion exchanges tokens, verifies profile and records requested scopes", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof URL ? input.toString() : String(input);
    calls.push(url);

    if (url === "https://api.instagram.com/oauth/access_token") {
      assert.equal(init?.method, "POST");
      return Response.json({
        access_token: "short-token",
        user_id: "17841400000000001",
      });
    }

    if (url.startsWith("https://graph.instagram.com/access_token?")) {
      assert.match(url, /grant_type=ig_exchange_token/);
      return Response.json({
        access_token: "long-token",
        token_type: "bearer",
        expires_in: 5_184_000,
      });
    }

    if (url.includes("/v26.0/me?fields=")) {
      assert.equal(
        init?.headers && new Headers(init.headers).get("authorization"),
        "Bearer long-token",
      );
      return Response.json({
        user_id: "17841400000000001",
        username: "brandspace",
        name: "BrandSpace",
      });
    }

    return new Response(null, { status: 404 });
  };

  const result = await completeInstagramOAuth(
    config,
    "authorization-code",
    fetchImpl,
  );

  assert.equal(result.accessToken, "long-token");
  assert.equal(result.providerAccountId, "17841400000000001");
  assert.equal(result.username, "brandspace");
  assert.equal(result.expiresInSeconds, 5_184_000);
  assert.deepEqual(result.scopes, [...INSTAGRAM_BUSINESS_LOGIN_SCOPES]);
  assert.equal(calls.length, 3);
  assert.equal(
    calls.some((url) => url.includes("/permissions")),
    false,
  );
});

test("OAuth completion rejects a profile that does not match the authorization user", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = input instanceof URL ? input.toString() : String(input);

    if (url === "https://api.instagram.com/oauth/access_token") {
      return Response.json({
        access_token: "short-token",
        user_id: "17841400000000001",
      });
    }
    if (url.startsWith("https://graph.instagram.com/access_token?")) {
      return Response.json({
        access_token: "long-token",
        expires_in: 5_184_000,
      });
    }
    if (url.includes("/v26.0/me?fields=")) {
      return Response.json({
        user_id: "17841400000000002",
        username: "brandspace",
      });
    }
    return new Response(null, { status: 404 });
  };

  await assert.rejects(
    completeInstagramOAuth(config, "authorization-code", fetchImpl),
    /does not match the verified profile/,
  );
});
