import assert from "node:assert/strict";
import test from "node:test";
import {
  InstagramPublishingClient,
  InstagramPublishingError,
} from "./instagram-publishing";

test("Instagram Login reel calls use the Instagram host and user bearer token", async () => {
  const calls: Array<{
    url: string;
    method: string;
    body: string;
    auth: string;
  }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: String(init?.body ?? ""),
      auth: new Headers(init?.headers).get("authorization") ?? "",
    });
    const value = url.includes("media_publish")
      ? { id: "300" }
      : url.includes("fields=status_code")
        ? { status_code: "FINISHED" }
        : url.includes("fields=id%2C")
          ? { id: "300", media_type: "VIDEO" }
          : { id: "200" };
    return Response.json(value);
  };
  const client = new InstagramPublishingClient("v26.0", fetchMock);
  const containerId = await client.createReelContainer({
    accountId: "100",
    accessToken: "secret-token",
    videoUrl: "https://media.example.test/reel.mp4",
    caption: "A caption",
  });
  assert.equal(containerId, "200");
  assert.equal(
    await client.getContainerStatus({
      containerId,
      accessToken: "secret-token",
    }),
    "FINISHED",
  );
  const mediaId = await client.publishReel({
    accountId: "100",
    containerId,
    accessToken: "secret-token",
  });
  assert.equal(mediaId, "300");
  await client.getPublishedMedia({ mediaId, accessToken: "secret-token" });
  assert.ok(
    calls.every((call) =>
      call.url.startsWith("https://graph.instagram.com/v26.0/"),
    ),
  );
  assert.ok(calls.every((call) => call.auth === "Bearer secret-token"));
  assert.match(calls[0]?.body ?? "", /media_type=REELS/);
  assert.match(calls[0]?.body ?? "", /caption=A\+caption/);
  assert.match(calls[2]?.body ?? "", /creation_id=200/);
  assert.ok(calls.every((call) => !call.url.includes("secret-token")));
});

test("provider failures are classified without persisting provider message text", async () => {
  const fetchMock: typeof fetch = async () =>
    Response.json(
      { error: { code: 190, message: "credential secret-token has expired" } },
      { status: 400 },
    );
  const client = new InstagramPublishingClient("v26.0", fetchMock);
  await assert.rejects(
    () =>
      client.getContainerStatus({
        containerId: "200",
        accessToken: "secret-token",
      }),
    (error: unknown) => {
      assert.ok(error instanceof InstagramPublishingError);
      assert.equal(error.kind, "AUTH");
      assert.equal(error.providerCode, 190);
      assert.doesNotMatch(error.message, /secret-token/);
      return true;
    },
  );
});

test("ambiguous transport failure is transient and never retried inside adapter", async () => {
  let calls = 0;
  const fetchMock: typeof fetch = async () => {
    calls++;
    throw new Error("network disconnected");
  };
  const client = new InstagramPublishingClient("v26.0", fetchMock);
  await assert.rejects(
    () =>
      client.publishReel({
        accountId: "100",
        containerId: "200",
        accessToken: "secret-token",
      }),
    (error: unknown) =>
      error instanceof InstagramPublishingError && error.kind === "TRANSIENT",
  );
  assert.equal(calls, 1);
});

test("insights reader forwards only an explicit metric allowlist and preserves provider data", async () => {
  let url = "";
  const data = [{ name: "views", values: [{ value: 12 }] }];
  const fetchMock: typeof fetch = async (input) => {
    url = String(input);
    return Response.json({ data });
  };
  const client = new InstagramPublishingClient("v26.0", fetchMock);
  assert.deepEqual(
    await client.getMediaInsights({
      mediaId: "300",
      accessToken: "token",
      metrics: ["views", "reach"],
    }),
    data,
  );
  assert.match(
    url,
    /^https:\/\/graph\.instagram\.com\/v26\.0\/300\/insights\?/,
  );
  assert.equal(new URL(url).searchParams.get("metric"), "views,reach");
  assert.equal(new URL(url).searchParams.get("period"), "day");
  await assert.rejects(
    () =>
      client.getMediaInsights({
        mediaId: "300",
        accessToken: "token",
        metrics: ["views", "not-allowed!"],
      }),
    InstagramPublishingError,
  );
});
