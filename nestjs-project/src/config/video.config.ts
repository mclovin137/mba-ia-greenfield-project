import { registerAs } from '@nestjs/config';

export default registerAs('video', () => ({
  endpoint: process.env.S3_ENDPOINT ?? 'http://storage:9000',
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT ?? 'http://storage:9000',
  region: process.env.S3_REGION ?? 'us-east-1',
  bucket: process.env.S3_BUCKET ?? 'streamtube',
  accessKeyId: process.env.S3_ACCESS_KEY ?? 'streamtube',
  secretAccessKey: process.env.S3_SECRET_KEY ?? 'streamtube-local-secret',
  redisHost: process.env.REDIS_HOST ?? 'queue',
  redisPort: Number(process.env.REDIS_PORT ?? 6379),
}));
