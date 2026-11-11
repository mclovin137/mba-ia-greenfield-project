---
kind: phase
name: phase-03-videos
---
# Phase 03 — Context

## Scope
Source: `docs/project-plan.md` Phase 03 and supplied challenge. Backend upload <=10GiB, draft persistence, asynchronous metadata/thumbnail processing, unique URL, streaming/download and real Compose storage/queue/worker. Frontend, publishing UI, comments, adaptive bitrate and editing/deletion of ready videos are outside scope.

## Existing foundation
NestJS 11 / TypeORM 0.3 / PostgreSQL 17. Global JWT guard and public decorator, domain exception filter, ValidationPipe, ChannelsService creates 1:1 user channel. Preserve these patterns and existing frontend. `dev` was absent; create it at original main, then feature branch from dev.

## Decisions Index and Capability Coverage
| Capability | Decision | Implementation |
|---|---|---|
| Object storage | TD-02 | storage.service, Compose MinIO |
| Queue + worker | TD-01, TD-03 | video-queue, worker.module/main |
| Large upload + draft | TD-02, TD-05 | videos.service, DTOs, entity |
| Metadata + thumbnail | TD-03 | video-processing.service |
| Unique URL | TD-04 | public_id UUID unique |
| Streaming + download | TD-04 | public controller redirects |
| Status + ownership | TD-05 | repository transaction locks, service |

Decision source: `docs/decisions/technical-decisions-phase-03-videos.md`. All five decisions are closed.

## Runtime boundaries
API handles JSON control-plane requests only. MinIO serves binary transfers; Redis stores queue data. Worker owns FFmpeg and temp disk, shares private storage/database. SQL processing rows form durable dispatch intent reconciled by worker. Only public storage URLs differ from internal Compose hosts.
