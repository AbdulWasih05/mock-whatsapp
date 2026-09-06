import "server-only";
import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PRESIGN_PUT_TTL_SECONDS = 60;
const PRESIGN_GET_TTL_SECONDS = 5 * 60;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// S3-compatible client — AWS S3 in production (omit STORAGE_ENDPOINT and the
// SDK derives it from the region), a local MinIO container in dev.
//
// Built on first use rather than at module load: Next.js evaluates this
// module during build-time page-data collection, where no storage
// credentials exist, and an eager client fails the build there.
let cached: S3Client | undefined;

function s3(): S3Client {
  if (cached) return cached;
  cached = new S3Client({
    // Undefined for real AWS S3; set only for R2/MinIO-style providers.
    endpoint: process.env.STORAGE_ENDPOINT,
    region: requireEnv("STORAGE_REGION"),
    credentials: {
      accessKeyId: requireEnv("STORAGE_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("STORAGE_SECRET_ACCESS_KEY"),
    },
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE === "true",
  });
  return cached;
}

function bucket(): string {
  return requireEnv("STORAGE_BUCKET");
}

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
    Bucket: bucket(),
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });
  return getSignedUrl(s3(), command, { expiresIn: PRESIGN_PUT_TTL_SECONDS });
}

export async function fetchObjectBuffer(key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const bytes = await res.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

// Safe → copy quarantine object to media/ and delete the quarantine copy.
// Returns the new media key.
export async function promoteToMedia(quarantineKey: string): Promise<string> {
  const mediaKey = mediaKeyFor(quarantineKey);
  await s3().send(
    new CopyObjectCommand({ Bucket: bucket(), CopySource: `${bucket()}/${quarantineKey}`, Key: mediaKey }),
  );
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: quarantineKey }));
  return mediaKey;
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

// Recipients only ever see a short-lived presigned GET — never a raw key,
// never a public URL (CLAUDE.md §6: "the bucket is private throughout").
export async function presignRead(key: string): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket(), Key: key });
  return getSignedUrl(s3(), command, { expiresIn: PRESIGN_GET_TTL_SECONDS });
}
