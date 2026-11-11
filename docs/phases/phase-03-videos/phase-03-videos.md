---
kind: phase
name: phase-03-videos
---
# Phase 03 — Upload e processamento de vídeos

## Objective
Implement all capabilities in context.md, following TD-01..05. Validation planning verdict: clean.

## Step Implementations

### SI-03.1 — Infrastructure and model
Add pinned SDK/BullMQ dependencies, typed video config/Joi, MinIO private bucket/CORS/lifecycle, Redis AOF/noeviction, worker Dockerfile and Compose services. Create Video entity and reversible migration using TypeORM Table API (CLI unavailable without container). Add repository abstraction, row locking and processing-intent scan.
**Dependencies:** Fases 01–02.
**Tests:** migration/entity/storage/queue real integration checks in videos.integration-spec.ts.
**Acceptance:** real services reachable; migration up/down; unique public IDs/FK/checks.

### SI-03.2 — Multipart API
Create DTOs, domain errors, thin protected controller and service: draft initiation, per-part signing, completion and cancellation, owner-only status. Validate maximum inclusive size, authoritative ListParts, exact part sizes, 24h lifetime, recovery via HeadObject, serialize owner operations. Mark processing durably before queue dispatch; worker reconciles.
**Dependencies:** SI-03.1.
**Tests:** videos.service.spec.ts and videos.e2e-spec.ts (ownership, validation, upload, duplicate complete/cancel).
**Acceptance:** bytes flow directly to storage; no memory buffer proportional to video; concurrent completion produces one job/video.

### SI-03.3 — Worker
Separate Nest application context (no HTTP/auth/mail) with metadata/FFmpeg service and queue reconciler. Stream source to temp disk, inspect probe, H.264/AAC faststart MP4, JPEG, upload derived keys, persist ready. Retry max 3, exponential 5s; persist generic error on final failure. Cleanup and graceful shutdown.
**Dependencies:** SI-03.2.
**Tests:** processing unit tests; real valid/corrupt video in integration/e2e; duplicate jobs no-op.
**Acceptance:** DB metadata/duration/keys correspond to real objects; worker retries and failures observable.

### SI-03.4 — Public delivery and verification
Ready-only stable metadata/media routes; 307 signed S3 stream/download/thumbnail. Document client multipart recipe, deployment/runbook and Codex foundation. Full Compose acceptance including Range/206/416, download attachment, 10GiB opt-in exercise. Repair pre-existing test typing lint failures without removing assertions or disabling lint; update existing migration round-trip test for the new table.
**Dependencies:** SI-03.3.
**Tests:** all unit + integration + e2e, tsc, lint and build.
**Acceptance:** full DoD passes in containers; record real results without marking unavailable checks green.

## Technical Specifications

### Data Model
`videos`: id UUID PK; public_id UUID UNIQUE; channel_id UUID FK channels CASCADE; title varchar(200); status varchar(16) CHECK draft/processing/ready/error/cancelled; source_key text unique; upload_id nullable text; expected_size bigint [1,10737418240]; content_type varchar(100); expires_at timestamptz; playback_key/thumbnail_key nullable text; duration nullable double precision; metadata nullable jsonb (width/height/codecs/container); error_code nullable varchar(64); created_at/updated_at timestamptz. Index channel_id and (status,created_at). Database generated UUID handles collisions through unique constraints.

### API Contracts
All protected routes require Bearer JWT and belong to current user's channel. JSON error envelope inherited.

| Method/path | Request | Success |
|---|---|---|
| POST /videos/uploads | title, size integer <=10737418240, content_type in video/mp4,video/webm,video/quicktime,video/x-matroska | 201 id, public_id, status, part_size=67108864, part_count, expires_at |
| POST /videos/:id/upload-parts/:partNumber | UUID id, integer part 1..ceil(size/part_size) | 201 url, expires_in=900 |
| POST /videos/:id/complete | no body | 202 id, public_id, status; idempotent after accepted |
| DELETE /videos/:id/upload | no body | 204; cancelled no-op |
| GET /videos/:id/status | UUID id | 200 owner view: status,duration,metadata,error_code,expires_at |
| GET /videos/:publicId | UUID public_id | 200 ready metadata + relative stable media URLs |
| GET /videos/:publicId/stream | optional Range retained on redirect | 307 signed MP4 GET → storage 200/206/416 |
| GET /videos/:publicId/download | — | 307 GET with attachment filename |
| GET /videos/:publicId/thumbnail | — | 307 signed JPEG GET |

Part signatures renewable within upload expiry. Server controls ETags with ListParts; completion requires exact declared bytes. If S3 completed before crash, HeadObject recovers. API size checks occur before S3 creation; invalid actual total transitions error. Storage/service errors propagate (5xx), never disguised as successful uploads.

### Authorization Matrix
| Action | Anonymous | Other owner | Owner |
|---|---|---|---|
| Create | 401 | own channel only | allow |
| Sign/complete/cancel/status | 401 | 404 | allow subject to status |
| Ready metadata/media | allow | allow | allow |
| Draft/error metadata/media | 404 | 404 | use protected status |

### Error Catalog
| Code | HTTP | Condition |
|---|---|---|
| VALIDATION_ERROR | 400 | DTO, UUID or part parse invalid |
| VIDEO_NOT_FOUND | 404 | absent/unowned/not ready |
| VIDEO_STATE_CONFLICT | 409 | invalid transition or expiry |
| INVALID_UPLOAD | 400 | wrong actual sizes/count |
| CHANNEL_NOT_FOUND | 404 | no channel for JWT user |
| PROCESSING_FAILED | stored only | retries exhausted / invalid media |

### Events/Messages
Queue `video-processing`, job `process-video`, payload `{version:1, videoId:UUID}`, jobId=videoId. Never enqueue S3 credentials, paths or URLs. API commits processing intent first; worker reconciles every 5 seconds and immediately on startup. Redis producer fails fast (maxRetriesPerRequest=1); worker connection blocks/reconnects normally. attempts=3, exponential 5000ms, retained completed/failed IDs. Worker verifies DB state and derives immutable keys. A ready record makes repeats no-op. Failed jobs/stall exhaustion observed by reconciler → error. Reconciliation recreates absent jobs after Redis loss. SIGTERM closes worker then queue and DB.

## Dependency Map
SI-03.1 → SI-03.2 → SI-03.3 → SI-03.4. API and worker share VideosCoreModule; only worker instantiates the queue producer/consumer and reconciliation.

## Deliverables
- [ ] SDK/model/storage/queue/worker and migration
- [ ] Owner multipart API and ready-only public delivery
- [ ] Real processing, metadata, thumbnail, cleanup and retries
- [ ] `docker compose exec nestjs-api npm test -- --runInBand`
- [ ] `docker compose exec nestjs-api npm run test:e2e -- --runInBand`
- [ ] `docker compose exec nestjs-api npx tsc --noEmit`
- [ ] `docker compose exec nestjs-api npm run lint` and `npm run build`
- [ ] Full 10GiB opt-in transfer (document separately if not exercised)
- [ ] AGENTS/CLAUDE, runbook and progress updated; feature branch pushed
