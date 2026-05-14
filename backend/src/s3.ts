import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from './env'

export const s3 = new S3Client({
  endpoint: env.SPACES_ENDPOINT,
  region: env.SPACES_REGION,
  credentials: {
    accessKeyId: env.SPACES_KEY,
    secretAccessKey: env.SPACES_SECRET,
  },
  // DigitalOcean Spaces uses virtual-hosted-style URLs (bucket.region.digitaloceanspaces.com)
  forcePathStyle: false,
})

export function presignUpload(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: env.SPACES_BUCKET,
    Key: key,
    ContentType: contentType,
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
