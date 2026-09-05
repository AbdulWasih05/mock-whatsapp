import "server-only";
import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// S3-compatible client — Cloudflare R2 in production, a local MinIO
// container in this dev environment (DECISIONS.md Phase 5). Same client,
// same calls, either way.
const client = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION ?? "auto",
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
});

const BUCKET = process.env.STORAGE_BUCKET!;
const PRESIGN_PUT_TTL_SECONDS = 60;
const PRESIGN_GET_TTL_SECONDS = 5 * 60;

export function newQuarantineKey(): string {
  return `quarantine/${randomUUID()}`;
}

function mediaKeyFor(quarantineKey: string): string {
  return quarantineKey.replace(/^quarantine\//, "media/");
}

// Presigned PUT with content-type and content-length baked into the
// signature — the client can only upload exactly what it declared
// (CLAUDE.md §6).
export async function presignUpload(key: string, contentType: string, contentLength: number): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(client, command, { expiresIn: PRESIGN_PUT_TTL_SECONDS });
}

export async function fetchObjectBuffer(key: string): Promise<Buffer> {
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

// Safe → copy quarantine object to media/ and delete the quarantine copy.
// Returns the new media key.
export async function promoteToMedia(quarantineKey: string): Promise<string> {
  const mediaKey = mediaKeyFor(quarantineKey);
  await client.send(
    new CopyObjectCommand({ Bucket: BUCKET, CopySource: `${BUCKET}/${quarantineKey}`, Key: mediaKey }),
  );
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: quarantineKey }));
  return mediaKey;
}

export async function deleteObject(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

// Recipients only ever see a short-lived presigned GET — never a raw key,
// never a public URL (CLAUDE.md §6: "the bucket is private throughout").
export async function presignRead(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(client, command, { expiresIn: PRESIGN_GET_TTL_SECONDS });
}
