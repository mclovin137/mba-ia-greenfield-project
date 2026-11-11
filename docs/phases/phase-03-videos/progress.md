# Phase 03 — Progress

Status: implemented_awaiting_compose_acceptance

Research → context → validate → resolve → build completed before implementation. Validation: clean. Tool: Codex, manual pipeline; no fabricated subagent/MCP executions.

| SI | Status | Verification |
|---|---|---|
| SI-03.1 | implemented | entity/migration/Compose/storage/queue authored; real infrastructure suite pending |
| SI-03.2 | implemented | 12 videos service/DTO unit tests passed |
| SI-03.3 | implemented | 3 processing unit tests passed; real FFmpeg e2e authored |
| SI-03.4 | implemented | local 75 tests / 10 suites passed; tsc, lint, build passed; Compose acceptance pending |

## Evidence
- `npm test -- --runInBand src/videos/videos.service.spec.ts src/worker/video-processing.service.spec.ts`: 15/15 passed.
- `npm test -- --runInBand --testPathIgnorePatterns='integration-spec|module.spec'`: 75/75 passed across 10 suites. Excludes DB-dependent legacy module specs, not claimed as full suite.
- `npx tsc --noEmit`: exit 0.
- `npm run lint`: exit 0, no disabled rules.
- `npm run build`: exit 0.
- Supplementary runtime: Node v24.22.1 on host (container targets Node 22 LTS); Docker binary/socket absent. See root AGENTS documented fallback. Full Compose checks are authoritative and remain pending.
- CI workflow `Backend videos` authored for full unit/integration/e2e, tsc, lint, build and standalone worker in containers.
- Exact 10GiB accepted by DTO/database contract tests and e2e upload initiation; complete 10GiB transfer NOT executed. `scripts/upload-video.ts` supports explicit capacity verification with a real source file.

## Review and deviations
- Context7 unavailable: official AWS/BullMQ/FFmpeg/TypeORM/Codex references used directly and recorded.
- Docker unavailable: no claim of green real-service suites. All SIs were authored and locally checked; per-SI real-service gating could not run here.
- TypeORM CLI unavailable before containers: migration authored using TypeORM Table API; integration round-trip is provided.
- Baseline full lint initially reported 150 errors in legacy test typing and a driver-error cast. Fixed types and mock references without weakening assertions/rules. Existing migration suite updated to include Videos migration.
- No feature or UI work outside videos; frontend unchanged. No branch commits to main.

## Operational follow-ups
Real storage quotas, TLS/production credentials, retained queue history and orphaned worker temp files after SIGKILL require deployment-level policies as described in README.

## CI execution
- First Actions run 42939605072 reached Docker Compose but Docker Hub no longer served `minio/mc`; no tests ran in that attempt. Changed MinIO and mc to the official quay.io registry with the same fixed release tags. Re-running acceptance.

- Quay returned 401 in run 42939748086. Compose now builds the official MinIO/mc tagged source releases instead of relying on removed/inaccessible historical images. Dockerfile retains upstream licenses. Acceptance retry pending.

- Source-build run 42939949882 exposed npm 10 vs npm 11 lockfile differences before tests. Regenerated the lockfile using npm 10.9.9 (container npm); `npm@10.9.9 ci --dry-run` passed. Consolidated push/PR CI concurrency to avoid duplicate builds.
