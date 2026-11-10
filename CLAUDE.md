# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A CRM for Noa's cosmetics clinic: leads, clients, appointments, Google Calendar sync, and WhatsApp automations. All UI text, statuses, and error messages are Hebrew. Users are `super_admin` (Eitan, technical) and `owner` (Noa).

"Shira" (שירה) is the WhatsApp AI agent that runs on 0ptive. This system pushes facts and messages to her through 0ptive's API. It never texts customers directly.

## Commands

pnpm 10 + turbo monorepo. Run from the root unless noted.

```bash
docker compose up -d                 # local Postgres 16 (noa/noa@localhost:5432/noa)
pnpm install
pnpm db:generate                     # prisma generate
pnpm --filter @noa/db push           # apply schema to local DB (this is how prod does it, see Deploy)
pnpm db:seed                         # users, services, automations, default settings
pnpm dev                             # backend :4000 (tsx watch) + frontend :3000 + shared tsc --watch
pnpm build
pnpm test                            # vitest, only packages/shared has tests
pnpm --filter @noa/shared exec vitest run src/phone.test.ts   # single test file
pnpm --filter @noa/shared exec vitest run -t "name"           # single test by name
pnpm --filter @noa/frontend exec tsc --noEmit                 # typecheck frontend
```

No linter is configured. `tsc` via `build` is the typecheck for backend, db, and shared.

`@noa/db` and `@noa/shared` export from `dist/`, so the backend sees changes only after they are built (`pnpm dev` watches shared; rebuild db after `prisma generate`). The frontend transpiles `@noa/shared` from source.

Env: copy `.env.example`. The backend needs `ENCRYPTION_KEY` (asserted on boot), `SESSION_SECRET`, `DATABASE_URL`, `FRONTEND_URL`. The seed needs `SEED_EITAN_PASSWORD` and `SEED_NOA_PASSWORD`.

## Architecture

**packages/shared**: pure domain rules used by both sides. Sales/ops/appointment status lists (`statuses.ts`), phone normalization (`phone.ts`, Israeli numbers, throws `PhoneInvalidError`), pricing and the 10% discount (`price.ts`), slot availability (`availability.ts`), default WhatsApp message templates with Hebrew placeholders like `{שם}` and `{קישור}` (`messages.ts`), and the `[NT: phone:SERVICE]` tag parser for Google events (`nt-tag.ts`). Put new business rules here when they need tests or the frontend needs them.

**packages/db**: Prisma schema and client singleton. Status fields are plain strings that hold the Hebrew values from `shared/statuses.ts`, not Prisma enums.

**backend** (Hono): `src/app.ts` mounts one router per module under `src/modules/<name>/routes.ts`, with logic in sibling `service.ts` files. Key flows:
- `pipelines/service.ts` owns contact state. A contact is a lead until `salesStatus` becomes `לקוחה פעילה`, which happens when she is marked arrived. Per-service ops status (חדשה/חוזרת/קבועה/בסיכון/רדומה/עזבה) is recomputed by `recomputeService`, and a daily sweep runs over all contacts. Every change writes a `TimelineEvent` via `addTimeline`.
- `appointments/service.ts`: every create or move runs inside `withCalendarLock`, a Postgres advisory lock, with an overlap check. A conflict throws `"taken"`. Booking, moving, or cancelling also tells Shira through `rememberFacts`.
- `automations/`: `enqueueAutomation` writes a `ScheduledJob` with an idempotency key. `run.ts` claims jobs with a conditional `updateMany` (pending → running) and retries at 1m/5m/30m. `prepare.ts` builds each message, and `nextSendAt` (`lib/send-window.ts`) restricts sends to Sun–Thu 08:00–20:00 Asia/Jerusalem. Automation rows are keyed (`beshvilech`, `discount`, `no_show`, …) and seeded.
- `calendar/google.ts`: service-account JWT. `mirrorAppointment` pushes to Google. `pullGoogle` adopts Google events carrying an `[NT:…]` tag as appointments and stores other events as `CalendarHold` blocks.
- `links/service.ts`: tokenized public links (`questionnaire`, `discount_booking`, `referral`) served by `public/routes.ts` and the frontend pages `/for-you`, `/book`, `/partners`. Tokens are stored encrypted.
- `external/routes.ts`: `/api/v1/external`, bearer `ApiToken` auth, for Shira and other tools to create leads and book. The user-facing guide lives in `frontend/lib/external-api-guide.ts`, so keep it in sync with this module.
- `src/index.ts` runs a 30s interval for due jobs, Google pull, and the daily status sweep. On boot it resets jobs stuck in `running`.

Third-party credentials (0ptive key, Google service account) live encrypted in the `Secret` table (`lib/crypto.ts`), not in env. Runtime config lives in `Setting` (JSON).

**Errors**: every error response has the shape `{ error: { code, message, field? } }` with a Hebrew message. Services throw `Error("not_found" | "taken" | "missing")`, and `http/errors.ts` maps them, along with Zod and `PhoneInvalidError`. Use `jsonError` for explicit returns.

**Auth**: cookie `noa_session` stores a hashed token in `Session` with a sliding 30-day expiry. `requireUser` is the middleware, and role checks are in `shared/permissions.ts`.

**frontend** (Next 15 app router, Tailwind, FullCalendar, RTL): authenticated pages live under `app/(app)/`. All calls go through `lib/api.ts`, which calls `/backend/...`, and Next proxies that to `BACKEND_URL` (middleware plus rewrite). Every screen must work at phone width.

## Deploy

- Backend: Render service `noa-api`, which auto-deploys on push to `main`. The start command runs `prisma db push`, then `seed`, then `start`, on every boot.
  - There are no migrations. Any change to `schema.prisma` hits production on the next deploy.
  - A destructive change (dropping or renaming a column, adding a required column without a default) makes `db push` refuse to run, and the service then fails to start. Plan such changes as additive steps, and ask before changing the schema.
  - The seed runs on every boot, so it must stay idempotent (`upsert` with `update: {}`).
- Frontend: Vercel. `BACKEND_URL` is needed at build time (listed in turbo `globalEnv`).

## Conventions

- Commit messages are one plain English sentence about the behavior change, written from the user's point of view (see `git log`).
- Status values, sources, and message text are Hebrew string literals compared directly. Reuse the constants from `@noa/shared` instead of retyping them. Some lists are still duplicated in the backend, for example `leadJourney` and `SOURCES_TUPLE` in `contacts/routes.ts`.
