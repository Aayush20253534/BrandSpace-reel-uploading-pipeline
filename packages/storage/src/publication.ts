import { createReadStream } from "node:fs";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface PublicationObject {
  key: string;
  sizeBytes: number;
  mimeType: string;
}

export interface TemporaryMediaDelivery {
  inspect(key: string): Promise<PublicationObject | null>;
  upload(input: PublicationObject & { sourcePath: string }): Promise<void>;
  signedReadUrl(key: string, lifetimeSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export interface S3TemporaryMediaDeliveryOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function validateS3TemporaryMediaDeliveryOptions(
  options: S3TemporaryMediaDeliveryOptions,
) {
  const endpoint = new URL(options.endpoint);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/"
  ) {
    throw new Error("Publication S3 endpoint must be a bare HTTPS origin");
  }
  if (!options.region.trim() || !options.bucket.trim()) {
    throw new Error("Publication S3 region and bucket are required");
  }
  if (!options.accessKeyId.trim() || !options.secretAccessKey.trim()) {
    throw new Error("Publication S3 credentials are required");
  }
}

export class S3TemporaryMediaDelivery implements TemporaryMediaDelivery {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3TemporaryMediaDeliveryOptions) {
    validateS3TemporaryMediaDeliveryOptions(options);
    this.bucket = options.bucket;
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
      maxAttempts: 3,
    });
  }

  async inspect(key: string): Promise<PublicationObject | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (
        result.ContentLength === undefined ||
        !Number.isSafeInteger(result.ContentLength)
      ) {
        throw new Error("Publication object has no safe content length");
      }
      return {
        key,
        sizeBytes: result.ContentLength,
        mimeType: result.ContentType ?? "",
      };
    } catch (error) {
      const status =
        typeof error === "object" && error !== null && "$metadata" in error
          ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
          : undefined;
      if (status === 404) return null;
      throw error;
    }
  }

  async upload(
    input: PublicationObject & { sourcePath: string },
  ): Promise<void> {
    const transfer = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: input.key,
        Body: createReadStream(input.sourcePath),
        ContentType: input.mimeType,
        ContentLength: input.sizeBytes,
      },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    });
    await transfer.done();
  }

  async signedReadUrl(key: string, lifetimeSeconds: number): Promise<string> {
    if (
      !Number.isInteger(lifetimeSeconds) ||
      lifetimeSeconds < 1 ||
      lifetimeSeconds > 86_400
    ) {
      throw new Error("Publication URL lifetime must be 1–86400 seconds");
    }
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: lifetimeSeconds },
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
