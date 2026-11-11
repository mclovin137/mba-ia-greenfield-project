# CLAUDE.md

## Project Overview

StreamTube — a video sharing platform (YouTube-like). Users can upload, manage, and publish videos. Anonymous users can watch freely; social features (comments, subscriptions, likes) require authentication.

More info in the project overview: [docs/project-plan.md](docs/project-plan.md)

## Repository Structure

This is a monorepo with two main areas:

- `nestjs-project/` — Backend API (NestJS 11, TypeScript, Express). Contains modules for users, channels, videos, comments, etc.
- `docs/` — Project documentation, architecture diagrams, and planning.
- `next-frontend/` — existing Next.js authentication UI (Fases 01–02)

## Architecture (C4 Container Diagram)

See `docs/diagrams/software-arch.mermaid` for the full diagram. Key containers:

- **Frontend** (Next.js) → calls API via REST, streams from Object Storage
- **API** (Nest.js) → business rules, auth, reads/writes DB, uploads to storage, publishes jobs to queue, sends emails
- **Video Worker** (FFmpeg) → consumes jobs from queue, processes videos, updates DB and storage
- **Database** (PostgreSQL) → users, channels, videos, comments, likes
- **Object Storage** (S3/MinIO) → video files and thumbnails
- **Message Queue** (BullMQ + Redis 7) → video processing job queue
- **Email Service** (SMTP) → account confirmation and password recovery

## Docker Networking

This project runs entirely in Docker containers. When configuring connections between services (database, cache, queue, etc.), **always use the Docker Compose service name** as the host — never `localhost` or `127.0.0.1`.

Inside a container, `localhost` refers to the container itself, not the host machine or other containers. Services communicate through the Docker Compose network using their service names (e.g., `db`, `nestjs-api`).

- **Correct:** `DB_HOST=db` (the Compose service name)
- **Wrong:** `DB_HOST=localhost`

This applies to all environment variables, configuration files, and code that references service hosts.

## Working Principles

- **Single Responsibility:** each module, service, and function should have a clear, focused responsibility. Re-evaluate adherence at every step — when a module starts owning logic or entities that are not its own (e.g., a service creating an entity from another domain), extract it immediately into the proper module instead of deferring to a later corrective task.
- **Type Safety:** Strict TypeScript usage across all layers.
- **Testing:** Strong emphasis on pyramid testing at all levels to ensure reliability and maintainability.
- **Code Quality:** Use ESLint and Prettier for consistent code style. Code reviews should focus on readability, maintainability, and adherence to best practices.
- **Documentation:** Comprehensive docs for architecture, setup, and troubleshooting in `docs/`.

## Definition of Done (Technical)

A change is only considered complete when **all** of the following pass:

1. The relevant test suite passes (unit + integration + e2e affected by the change).
2. The full test suite passes before finishing the task.
3. TypeScript compiles cleanly: `npx tsc --noEmit` exits with code 0. Compilation errors must never be left as debt for future tasks.
4. Lint passes: `npm run lint`.

If any of these fails, the task is not done — fix the underlying issue before declaring completion.


## Git Conventions

- **Main branch:** `main` — never commit directly to it
- Branches: `feature/*`, `bugfix/*`, `hotfix/*`, `docs/*`
- **Commits:** short, descriptive messages focused on the "why" of the change
- **Workflow:** Git Flow conventions. Two long-lived branches:
  - `main` — stable, production-ready code 
  - `dev` — integration branch; all feature/bugfix/hotfix branches start from `dev` and merge back into `dev`
  - When `dev` is stable, it is merged into `main`

## Testing Policy

Every change must be tested. During development, run only the tests related to the modified code. Before finishing, always run the full test suite to ensure nothing is broken.

## Scope Limits

- Work on **one feature, fix, or refactoring at a time** — do not mix scopes
- Do not include cosmetic changes (formatting, renaming) alongside functional changes
- If something out of scope comes up during work, note it as a separate task instead of acting on it
- Focus on the defined scope for each task to ensure clarity and maintainability of the codebase.
- If you identify a necessary change that is out of scope, create a new issue or task for it instead of including it in the current work.

## Agent Skill Usage

When working on any task (planning, implementing, debugging, refactoring, 
reviewing, etc.), decompose the request into its underlying subtasks and 
concerns, then identify which available skills match any of them and activate 
those skills.

## Library Documentation Lookup

Before implementing any feature, you MUST use the **context7** MCP tool to look up the relevant library APIs and official documentation.

Always:

- Check the installed library version in the project manifest
- Retrieve the corresponding documentation using context7
- Cross-reference APIs to avoid deprecated or incompatible patterns
- Follow the official documentation over training data

Skip documentation lookup only for trivial operations such as:

- Variable declarations
- Basic control flow
- Simple CRUD using established project patterns

If a library is involved and there is uncertainty, documentation lookup is mandatory.
If the documentation returned does not match the installed version, flag the discrepancy before proceeding.
## Codex workflow port
Read `nestjs-project/AGENTS.md` and the matching `.claude/rules/` before edits.
The existing `.claude/skills/` remain reference material; execute their pipeline manually in Codex: research → context → validate → resolve → build → implement. Preserve the same artifact paths and SI contracts. Read source files directly instead of requiring Claude-specific Agent/Task tools. The user requested implementation through delivery; carry out the full pipeline and Git operations.

MCP configuration lives in `.codex/config.toml`. Trust the project explicitly before enabling project-scoped MCP. Context7 is preferred; if unavailable, consult official documentation directly and record the fallback. Never claim MCP validation occurred when it did not.

Run application/infrastructure checks in Docker. When the execution environment has no Docker binary or daemon, supplementary local compile/lint/unit checks are allowed, but integration/e2e acceptance remains pending until the Compose checks pass. Do not mock external infrastructure in integration/e2e tests to bypass this limitation.

## Phase 03 — Videos

Implemented backend files live in `nestjs-project/src/videos/` and `nestjs-project/src/worker/`. `VideosModule` exposes owner-only multipart control routes (`POST /videos/uploads`, `POST /videos/:id/upload-parts/:partNumber`, `POST /videos/:id/complete`, `DELETE /videos/:id/upload`, `GET /videos/:id/status`) through the global JWT guard. `GET /videos/:publicId` and `/stream`, `/download`, `/thumbnail` are public only when ready. UUID routes use ParseUUIDPipe. See `docs/phases/phase-03-videos/phase-03-videos.md` for request, error and authorization contracts.

The private MinIO bucket stores originals and derived files. Uploads go directly to S3 in 64MiB parts, never through the API; maximum 10GiB inclusive. The API validates authoritative storage sizes. SQL row locks serialize owner operations. SQL `processing` state is a durable queue intent; the worker reconciles every 5s and publishes deterministic BullMQ IDs to Redis 7. Separate worker container (concurrency 1, max 3 attempts) invokes FFmpeg/ffprobe, streams files to temporary disk, generates H.264/AAC faststart MP4 and JPEG, persists metadata and ready/error, cleans temporary attempts. SDK multipart upload also supports derived objects larger than 5GiB.

Status: draft → processing → ready/error; unfinished draft can be cancelled/expired. Public media routes issue 307 redirects to 15-minute S3 signed reads; S3 serves Range/206/416. Stable URLs use unique public UUIDs. Worker and API share the model/storage/repository module; only worker instantiates the queue producer/consumer.

Compose adds `storage`, `storage-init`, `queue`, `worker`, persistent volumes and the optional `mcp-postgres` tool profile. API runs migrations at startup; worker waits for a healthy API. Internal hosts use service names; only S3_PUBLIC_ENDPOINT names the client-reachable address. The backend Dockerfile includes FFmpeg. Setup and acceptance commands: `docs/phases/phase-03-videos/README.md`. Full tests must use an isolated DB and stopped standalone worker. The test harness boots its own real worker.

Planning artifacts and verification evidence live in `docs/phases/phase-03-videos/`; no frontend changes are included.
