# Phase 03 — Library references

| Library | Pin | APIs | Official source |
|---|---|---|---|
| @aws-sdk/client-s3 | 3.883.0 | S3Client, multipart commands, ListParts, HeadObject, GetObject, PutObject | https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/ |
| @aws-sdk/s3-request-presigner | 3.883.0 | getSignedUrl | https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/ |
| @aws-sdk/lib-storage | 3.883.0 | Upload multipart streaming with bounded queueSize=2 | https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-lib-storage/ |
| bullmq | 5.58.5 | Queue.add/getJob, Worker, attempts/backoff, close | https://docs.bullmq.io/guide/workers |
| FFmpeg/ffprobe | Debian package in Docker image | probe JSON, libx264, AAC, faststart, frame JPEG | https://ffmpeg.org/ffmpeg-all.html |
| TypeORM | existing ^0.3.28 | repository, transactions, row locks, Table migration | https://typeorm.io/docs/advanced-topics/transactions/ |
| Codex | configuration format | AGENTS.md, .codex/config.toml MCP | https://developers.openai.com/codex/guides/agents-md ; https://developers.openai.com/codex/mcp |

Context7 unavailable in execution tool registry. Official pages consulted directly before implementation; no MCP result is claimed. Lockfile fixes exact transitive versions. FFmpeg patch version follows the Debian base image; inspect `ffmpeg -version` in the built container for deployment provenance.

MinIO/mc images use official `quay.io/minio/` release tags because Docker Hub community repositories are unavailable. Official reference: https://github.com/minio/minio/blob/master/docs/orchestration/docker-compose/docker-compose.yaml .
