import {
  S3Client,
  PutObjectCommand,
  PutObjectAclCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createReadStream } from 'node:fs'
import { env } from './env'

export const s3 = new S3Client({
  endpoint: env.SPACES_ENDPOINT,
  region: env.SPACES_REGION,
  credentials: {
    accessKeyId: env.SPACES_KEY,
    secretAccessKey: env.SPACES_SECRET,
  },
  // DigitalOcean Spaces uses virtual-hosted-style URLs (bucket.region.digitaloceanspaces.com)
  forcePathStyle: env.SPACES_FORCE_PATH_STYLE,
  // AWS SDK >= 3.729 adds CRC32 trailer checksums (aws-chunked) to every upload by default.
  // S3-compatible stores such as DigitalOcean Spaces do not understand that framing and either
  // reject the PUT or store the chunk markers inside the object (corrupt COG). Only send
  // checksums when an operation requires them.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

export function presignUpload(key: string, contentType: string, acl?: 'public-read'): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: env.SPACES_BUCKET,
    Key: key,
    ContentType: contentType,
    ...(acl ? { ACL: acl } : {}),
  })
  return getSignedUrl(s3, command, { expiresIn: env.PRESIGN_EXPIRY_SECONDS })
}

export function presignDownload(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.SPACES_BUCKET,
    Key: key,
  })
  return getSignedUrl(s3, command, { expiresIn: env.PRESIGN_EXPIRY_SECONDS })
}

/** Read a whole (small) object into memory, e.g. to re-check a layer file. */
export async function getObjectBuffer(key: string): Promise<Buffer> {
  const r = await s3.send(new GetObjectCommand({ Bucket: env.SPACES_BUCKET, Key: key }))
  const bytes = await r.Body?.transformToByteArray()
  return Buffer.from(bytes ?? [])
}

export function deleteObject(key: string): Promise<unknown> {
  return s3.send(new DeleteObjectCommand({ Bucket: env.SPACES_BUCKET, Key: key }))
}

export function uploadObject(key: string, body: Buffer, contentType: string): Promise<unknown> {
  return s3.send(new PutObjectCommand({
    Bucket: env.SPACES_BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }))
}

/** Stream a local file to Spaces without reading it into memory. */
export function uploadFile(key: string, filePath: string, contentType: string): Promise<unknown> {
  return s3.send(new PutObjectCommand({
    Bucket: env.SPACES_BUCKET,
    Key: key,
    Body: createReadStream(filePath),
    ContentType: contentType,
  }))
}

/** List every object under a prefix (handles pagination). */
export async function listPrefix(prefix: string): Promise<{ key: string; size: number }[]> {
  const out: { key: string; size: number }[] = []
  let token: string | undefined
  do {
    const r = await s3.send(new ListObjectsV2Command({
      Bucket: env.SPACES_BUCKET, Prefix: prefix, ContinuationToken: token,
    }))
    for (const o of r.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0 })
    token = r.IsTruncated ? r.NextContinuationToken : undefined
  } while (token)
  return out
}

export function makePublicRead(key: string): Promise<unknown> {
  return s3.send(new PutObjectAclCommand({ Bucket: env.SPACES_BUCKET, Key: key, ACL: 'public-read' }))
}

/**
 * Public (CDN-free) URL for an object. SPACES_PUBLIC_BASE_URL wins when set (e.g. a CDN or a local
 * stand-in); otherwise it is derived from the endpoint the way DigitalOcean serves it:
 * https://<bucket>.<region>.digitaloceanspaces.com/<key>
 */
export function publicUrl(key: string): string {
  const encoded = key.split('/').map(encodeURIComponent).join('/')
  if (env.SPACES_PUBLIC_BASE_URL) return `${env.SPACES_PUBLIC_BASE_URL.replace(/\/+$/, '')}/${encoded}`
  const u = new URL(env.SPACES_ENDPOINT)
  return env.SPACES_FORCE_PATH_STYLE
    ? `${u.origin}/${env.SPACES_BUCKET}/${encoded}`
    : `${u.protocol}//${env.SPACES_BUCKET}.${u.host}/${encoded}`
}
