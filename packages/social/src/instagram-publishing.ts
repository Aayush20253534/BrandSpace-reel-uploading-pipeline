import { normalizeInstagramGraphVersion } from "./instagram.js";

type FetchLike = typeof fetch;

export type InstagramPublishingFailure =
  "AUTH" | "RATE_LIMIT" | "TRANSIENT" | "PERMANENT";

export class InstagramPublishingError extends Error {
  constructor(
    readonly operation: string,
    readonly kind: InstagramPublishingFailure,
    readonly httpStatus: number | null,
    readonly providerCode: number | null = null,
  ) {
    super(`${operation} failed: ${kind}`);
    this.name = "InstagramPublishingError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireId(value: unknown, operation: string) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new InstagramPublishingError(operation, "PERMANENT", null);
  }
  return value;
}

function classify(
  status: number,
  code: number | null,
): InstagramPublishingFailure {
  if (status === 401 || status === 403 || code === 190) return "AUTH";
  if (status === 429 || code === 4 || code === 17 || code === 32) {
    return "RATE_LIMIT";
  }
  if (status >= 500 || status === 408) return "TRANSIENT";
  return "PERMANENT";
}

export class InstagramPublishingClient {
  private readonly graphVersion: string;

  constructor(
    graphVersion: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    this.graphVersion = normalizeInstagramGraphVersion(graphVersion);
  }

  private async request(
    operation: string,
    path: string,
    accessToken: string,
    body?: URLSearchParams,
    fields?: string,
  ) {
    const url = new URL(
      `https://graph.instagram.com/${this.graphVersion}/${path}`,
    );
    if (fields) url.searchParams.set("fields", fields);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: body ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: "application/json",
          ...(body
            ? { "content-type": "application/x-www-form-urlencoded" }
            : {}),
        },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new InstagramPublishingError(operation, "TRANSIENT", null);
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const detail =
        record(payload) && record(payload.error) ? payload.error : null;
      const code =
        detail && typeof detail.code === "number" ? detail.code : null;
      throw new InstagramPublishingError(
        operation,
        classify(response.status, code),
        response.status,
        code,
      );
    }
    if (!record(payload)) {
      throw new InstagramPublishingError(
        operation,
        "PERMANENT",
        response.status,
      );
    }
    return payload;
  }

  async createReelContainer(input: {
    accountId: string;
    accessToken: string;
    videoUrl: string;
    caption?: string | null;
  }) {
    const accountId = requireId(input.accountId, "container.create");
    const mediaUrl = new URL(input.videoUrl);
    if (mediaUrl.protocol !== "https:") {
      throw new InstagramPublishingError("container.create", "PERMANENT", null);
    }
    const body = new URLSearchParams({
      media_type: "REELS",
      video_url: mediaUrl.toString(),
    });
    if (input.caption) body.set("caption", input.caption);
    const result = await this.request(
      "container.create",
      `${accountId}/media`,
      input.accessToken,
      body,
    );
    return requireId(result.id, "container.create");
  }

  async getContainerStatus(input: {
    containerId: string;
    accessToken: string;
  }) {
    const id = requireId(input.containerId, "container.status");
    const result = await this.request(
      "container.status",
      id,
      input.accessToken,
      undefined,
      "status_code",
    );
    if (typeof result.status_code !== "string") {
      throw new InstagramPublishingError("container.status", "PERMANENT", 200);
    }
    return result.status_code;
  }

  async publishReel(input: {
    accountId: string;
    containerId: string;
    accessToken: string;
  }) {
    const accountId = requireId(input.accountId, "media.publish");
    const containerId = requireId(input.containerId, "media.publish");
    const result = await this.request(
      "media.publish",
      `${accountId}/media_publish`,
      input.accessToken,
      new URLSearchParams({ creation_id: containerId }),
    );
    return requireId(result.id, "media.publish");
  }

  async getPublishedMedia(input: { mediaId: string; accessToken: string }) {
    const id = requireId(input.mediaId, "media.verify");
    const result = await this.request(
      "media.verify",
      id,
      input.accessToken,
      undefined,
      "id,media_type,media_product_type,timestamp,permalink,caption",
    );
    if (result.id !== id) {
      throw new InstagramPublishingError("media.verify", "PERMANENT", 200);
    }
    return result;
  }
}
