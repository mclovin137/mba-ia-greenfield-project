# Phase 03 — Progress

Status: completed — functional acceptance passed in Compose; full-size capacity exercise not executed

Research → context → validate → resolve → build completed before implementation. Validation: clean. Tool: Codex, manual pipeline; no fabricated subagent/MCP executions.

| SI | Status | Verification |
|---|---|---|
| SI-03.1 | completed | real migration up/down, DB constraints, signed multipart/ranges/download and Redis retry/deduplication passed |
| SI-03.2 | completed | 12 unit tests plus real HTTP ownership/multipart/state checks passed |
| SI-03.3 | completed | 3 unit tests; real FFmpeg success/thumbnail and corrupt-video retry/error e2e passed |
| SI-03.4 | completed | 219 tests in 30 suites passed in Compose; tsc, lint, build and standalone worker passed |

## Evidence
- `npm test -- --runInBand src/videos/videos.service.spec.ts src/worker/video-processing.service.spec.ts`: 15/15 passed.
- `npm test -- --runInBand --testPathIgnorePatterns='integration-spec|module.spec'`: 75/75 passed across 10 suites. Excludes DB-dependent legacy module specs, not claimed as full suite.
- `npx tsc --noEmit`: exit 0.
- `npm run lint`: exit 0, no disabled rules.
- `npm run build`: exit 0.
- Supplementary runtime: Node v24.22.1 on host (container targets Node 22 LTS); Docker binary/socket absent. See root AGENTS documented fallback. Full Compose checks are authoritative and subsequently passed in GitHub Actions (see final evidence below).
- CI workflow `Backend videos` ran full unit/integration/e2e, tsc, lint, build and standalone worker in containers; all steps passed.
- Exact 10GiB accepted by DTO/database contract tests and e2e upload initiation; complete 10GiB transfer NOT executed. `scripts/upload-video.ts` supports explicit capacity verification with a real source file.

## Review and deviations
- Context7 unavailable: official AWS/BullMQ/FFmpeg/TypeORM/Codex references used directly and recorded.
- Docker was unavailable locally. All SIs were authored and locally checked; per-SI real-service gating could not run locally. The entire real-service suite subsequently passed in remote Compose CI.
- TypeORM CLI unavailable before containers: migration authored using TypeORM Table API; integration round-trip is provided.
- Baseline full lint initially reported 150 errors in legacy test typing and a driver-error cast. Fixed types and mock references without weakening assertions/rules. Existing migration suite updated to include Videos migration.
- No feature or UI work outside videos; frontend unchanged. No branch commits to main.

## Operational follow-ups
Real storage quotas, TLS/production credentials, retained queue history and orphaned worker temp files after SIGKILL require deployment-level policies as described in README.

## CI execution
- First Actions run 42939605072 reached Docker Compose but Docker Hub no longer served `minio/mc`; no tests ran in that attempt. Changed MinIO and mc to the official quay.io registry with the same fixed release tags. Re-running acceptance.

- Quay returned 401 in run 42939748086. Compose now builds the official MinIO/mc tagged source releases instead of relying on removed/inaccessible historical images. Dockerfile retains upstream licenses. Acceptance retry pending.

- Source-build run 42939949882 exposed npm 10 vs npm 11 lockfile differences before tests. Regenerated the lockfile using npm 10.9.9 (container npm); `npm@10.9.9 ci --dry-run` passed. Consolidated push/PR CI concurrency to avoid duplicate builds.

- Container build run 42940323734 found the image working directory owned by root. Fixed ownership before the non-root build. Build config now explicitly scopes rootDir/include to src, preserving `dist/main.js` and `dist/worker/main.js` after adding the optional upload script. Added explicit entrypoint existence checks locally. Migration test teardown now drops dependent tables sequentially to avoid CASCADE deadlocks.

- CI run 43080458713 successfully built the API and official MinIO/mc sources. Storage init rejected an abort-only lifecycle rule in the fixed MinIO release. Replaced that incompatible rule with the release's native `MINIO_API_STALE_UPLOADS_EXPIRY=24h` and hourly cleanup; application worker cancellation remains unchanged. S3 production lifecycle guidance remains documented.

- The stack now boots successfully in Compose. While reviewing full integration execution, fixed the legacy migration reset to drop its surviving PostgreSQL enum before replay; database connections close in finally even if migration restoration fails. This preserves failure reporting and prevents a failed test from leaking the connection pool.

- The first full Compose test execution reported 160 passed / 3 failed (26 suites). Logs confirmed the legacy enum replay failure and two new test-harness defects: TypeORM save mutated a shared fixture, so the intended duplicate INSERT became an UPDATE; dynamic SDK imports in cleanup required Jest VM modules. Fixtures now use a fresh object per insert and SDK command imports are static. Assertions and production constraints remain intact. The leaked migration pool explained the test process remaining open.

## Final Compose evidence

Run: https://github.com/mclovin137/mba-ia-greenfield-project/actions/runs/43082855405
Code commit: `5ae0e193e49fe915b831b89ab4dee18a169f0e89`. Job: `compose-acceptance`, conclusion: success.

| Check | Result |
|---|---|
| Build/start API + PostgreSQL/MinIO/Redis/Mailpit | passed |
| npm test -- --runInBand | 163/163 tests, 26/26 suites passed |
| Migration replay before HTTP suite | passed |
| npm run test:e2e -- --runInBand | 56/56 tests, 4/4 suites passed |
| npx tsc --noEmit | exit 0 |
| npm run lint | exit 0 |
| npm run build | exit 0; both runtime entrypoints present |
| Standalone worker container + FFmpeg | passed; FFmpeg 5.1.9-0+deb12u1 |
| Full 10GiB binary transfer | not executed; capacity utility and boundary contracts provided |

The video e2e suite passed with real media processing, stored MP4/JPEG, Range 206 delivery, download attachment, owner/stranger JWTs, concurrent idempotent completion, multipart size rejection/cancellation and corrupt-video retries ending in error. The infrastructure suite also checked Range 416, DB maximum-size/unique/FK constraints and real Redis retries/deduplication. No external-service mocks were substituted in these suites.

Final documentation update exports the backend OpenAPI contract from compiled controller/DTO metadata (no handler invocation/DB I/O for this supplementary export) and aligns the architecture diagram with the SQL intent/worker dispatch design. The real AppModule OpenAPI integration/export tests separately passed in the Compose suite. Frontend remains unchanged.
