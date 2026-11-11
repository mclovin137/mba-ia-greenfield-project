---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-11-10
---
# Technical Decisions — Phase 03: vídeos

Source: `docs/project-plan.md`, Phase 03 and the supplied challenge. Backend only; retain NestJS 11, TypeORM, PostgreSQL and S3-compatible MinIO.

## TD-01 — Queue and delivery
**Scope:** Backend / Infrastructure
**Capability:** Fila de processamento em segundo plano e worker.
**Options:** BullMQ/Redis has retry, stalled-job recovery and job IDs, but adds Redis; RabbitMQ has routing/acknowledgement but requires a custom retry/deduplication contract; pg-boss reuses PostgreSQL but shares database contention with API transactions.
**Decision:** BullMQ 5 with Redis 7 (AOF, noeviction), separate worker container, concurrency 1. Three attempts with exponential backoff. Deterministic job ID = video UUID. Keep completed/failed jobs for deduplication. SQL `processing` rows are a durable dispatch intent: periodically reconcile with Redis. PostgreSQL state remains authoritative; ready jobs are no-ops.
**Trade-off:** At-least-once delivery requires deterministic object keys and idempotent DB writes. Redis loss can repeat FFmpeg work, without creating duplicate videos. Queue retention needs operational monitoring.

## TD-02 — Direct multipart upload
**Scope:** Backend / future clients
**Capability:** Upload de até 10GB sem travar; pré-cadastro como rascunho; object storage.
**Options:** API proxy streaming avoids buffering but ties API connections/bandwidth to 10GB; tus adds an upload server; S3 multipart signed URLs use the required storage directly.
**Decision:** Private bucket, direct multipart, 64MiB parts, maximum 10 * 1024^3 bytes (10GiB, inclusive; covers decimal 10GB). Draft created before S3 initiation. Per-part URLs expire in 15 minutes and are renewable for 24 hours. API checks ListParts sizes/count and HeadObject before accepting. No file bytes enter API. Client does not submit ETags; server lists authoritative parts. Completion serialized by row lock and idempotent after S3 completion. Cancel endpoint aborts multipart. Bucket lifecycle aborts stale multipart after one day.
**Trade-off:** Requires client chunking/CORS and externally reachable S3 endpoint. Presigned credentials are bearer capabilities; never log URLs. Declared size is validated against actual parts; the storage account must also have quotas to bound malicious unfinished transfers. Source key: channels/{channelUUID}/videos/{videoUUID}/source. Never derive paths from user filenames.

## TD-03 — Processing
**Scope:** Backend
**Capability:** Processamento automático; extração de duração/metadados e thumbnail.
**Options:** Native FFmpeg subprocess vs wrapper dependency vs external transcoding.
**Decision:** FFmpeg/ffprobe executables, argument arrays (no shell), private local temporary directory per attempt, streamed S3 transfers (bounded memory), 2h child timeout, cleanup in finally. Probe local file with file/pipe-only protocol whitelist. Encode H.264/AAC MP4 with +faststart and a JPEG thumbnail from frame zero. Concurrency 1, one FFmpeg thread; reserve >=35GiB scratch disk per active job.
**Trade-off:** CPU and temporary disk expense buys predictable browser playback independent of source container/codecs; this phase does not include adaptive HLS/DASH. Never expose raw probe output or decoder errors to public clients.

## TD-04 — URL and delivery
**Scope:** Backend / future clients
**Capability:** URL única, streaming e download.
**Options:** UUID vs title slug; API proxy vs direct signed S3 reads.
**Decision:** UUIDv4 public_id plus DB unique constraint. Public stable API route GET /videos/{publicId}; ready-only metadata. Streaming/download/thumbnail endpoints return HTTP 307 to short-lived private S3 GETs. Storage serves Range/206/416; redirect preserves Range. Download sets attachment with server-generated filename. Original remains private; downloads use playable MP4.
**Trade-off:** Signed URLs expire (renew via stable endpoint); S3 must be reachable by clients. No title collisions.

## TD-05 — Lifecycle and authorization
**Scope:** Backend
**Capability:** Vídeos ligados ao canal; ciclo de status e falhas.
**Decision:** draft → processing → ready | error; draft → cancelled on abort/expiry. Owner JWT required for create, sign, complete, cancel, status. Ready metadata/media public as inherited platform requirement; no publication/moderation feature added. Processing errors stay processing during retries and become error after exhaustion, including reconciliation of stalled jobs. There is no manual retry endpoint this phase. ListParts failure leaves draft retryable; completed source recovers via HeadObject. Invalid size marks error. SQL row locks serialize completion/cancel/sign; S3 side effects are recovered using immutable keys.

## Official references consulted
- https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListParts.html
- https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-s3-request-presigner/
- https://docs.bullmq.io/guide/connections
- https://docs.bullmq.io/guide/retrying-failing-jobs
- https://docs.bullmq.io/patterns/idempotent-jobs
- https://ffmpeg.org/ffmpeg-formats.html

Context7 was not exposed by this session; official documentation was accessed directly. This is a recorded environment deviation, not a claim that Context7 ran.
