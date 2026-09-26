import { prisma } from "../packages/database/src/index.ts";
import {
  cleanupPublicationMedia,
  createCanonicalStorage,
  createTemporaryDelivery,
  preparePublicationMedia,
} from "../apps/worker/src/publication-media.ts";

async function main() {
  const [action, publishingJobId] = process.argv.slice(2);
  try {
    const delivery = createTemporaryDelivery();
    if (action === "prepare" && publishingJobId) {
      const canonical = createCanonicalStorage();
      await preparePublicationMedia(publishingJobId, canonical, delivery);
      const record = await prisma.publicationMediaDelivery.findUniqueOrThrow({
        where: { publishingJobId },
        select: {
          id: true,
          publishingJobId: true,
          mediaAssetId: true,
          state: true,
          sizeBytes: true,
          expiresAt: true,
        },
      });
      console.log(
        JSON.stringify({
          ...record,
          sizeBytes: record.sizeBytes.toString(),
        }),
      );
    } else if (action === "probe" && publishingJobId) {
      const record = await prisma.publicationMediaDelivery.findUniqueOrThrow({
        where: { publishingJobId },
      });
      if (
        record.state !== "READY" ||
        record.expiresAt.getTime() <= Date.now() + 5 * 60 * 1_000
      ) {
        throw new Error("Publication media is not ready for a delivery probe");
      }
      const signedUrl = await delivery.signedReadUrl(record.objectKey, 300);
      const response = await fetch(signedUrl, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      const contentType = response.headers.get("content-type");
      const sizeBytes = Number(response.headers.get("content-length"));
      await response.body?.cancel();
      if (
        response.status !== 200 ||
        contentType !== "video/mp4" ||
        sizeBytes !== Number(record.sizeBytes)
      ) {
        throw new Error(
          "Signed publication URL did not return the expected MP4",
        );
      }
      console.log(
        JSON.stringify({ status: response.status, contentType, sizeBytes }),
      );
    } else if (action === "cleanup") {
      console.log(JSON.stringify(await cleanupPublicationMedia(delivery)));
    } else {
      throw new Error(
        "Usage: npm run publication:media -- prepare <publishing-job-id> | probe <publishing-job-id> | cleanup",
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    "Publication media command failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  process.exitCode = 1;
});
