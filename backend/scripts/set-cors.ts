/**
 * One-time script: applies a CORS policy to the Spaces bucket so browsers
 * can PUT (upload) directly from localhost and any production domain.
 *
 * Run:  npx ts-node --esm scripts/set-cors.ts
 *   or: npx tsx scripts/set-cors.ts
 */
import 'dotenv/config'
import { S3Client, PutBucketCorsCommand } from '@aws-sdk/client-s3'
import { env } from '../src/env.js'

const s3 = new S3Client({
  endpoint: env.SPACES_ENDPOINT,
  region: env.SPACES_REGION,
  credentials: {
    accessKeyId: env.SPACES_KEY,
    secretAccessKey: env.SPACES_SECRET,
  },
  forcePathStyle: false,
})

await s3.send(new PutBucketCorsCommand({
  Bucket: env.SPACES_BUCKET,
  CORSConfiguration: {
    CORSRules: [
      {
        AllowedOrigins: ['*'],          // tighten to your domain in production
        AllowedMethods: ['GET', 'PUT', 'DELETE', 'HEAD'],
        AllowedHeaders: ['*'],
        ExposeHeaders: ['ETag'],
        MaxAgeSeconds: 3600,
      },
    ],
  },
}))

console.log(`CORS policy applied to bucket: ${env.SPACES_BUCKET}`)
