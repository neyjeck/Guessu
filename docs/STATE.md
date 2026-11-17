---
tags:
  - state
  - tracker
  - anime-guesser
---

# Project State Tracker

← Back to [[INDEX]] | Next steps: [[BACKLOG]] | API: [[API_CONTRACT]] | Rules: [[GIT_WORKFLOW]]

> **Note:** Keep this file strictly under 100 lines. Read at the start of every session and update upon task completion.

## Current Context
- **Active Branch:** `dev` (merged `feat/auth`, `feat/auth-tests`, `feat/google-oauth`)
- **Latest Release Branch:** `main` (initial scaffolding synced)
- **CI Pipeline:** `.github/workflows/ci.yml` configured for `main`, `dev`, and `feat/**`
- **Database Status:** Prisma migrations `add_user_auth` & `add_google_oauth` applied (`User` with optional `passwordHash`, unique `googleId`, `Role` enum, `updatedAt`; `Anime`; `GameSession`). PostgreSQL 16 (`pg_trgm`) and Redis 7 active.

## Completed Milestones
- [x] Repository directory architecture initialized (`backend`, `frontend`, `scripts`, `data`, `docs`, `.github`).
- [x] Root `docker-compose.yml` configured with PostgreSQL 16 (`pg_trgm` init script) and Redis 7.
- [x] NestJS modular monolith scaffolded (`PrismaModule`, `RedisModule`, `AuthModule`, `UsersModule`, `AnimeModule`, `GameModule`, `LeaderboardModule`).
- [x] Prisma ORM schema (`backend/prisma/schema.prisma`) migrated with `add_user_auth` (`Role` enum, `passwordHash`, `updatedAt`).
- [x] Production-grade Authentication & Registration (`feat/auth`):
  - `argon2id` password hashing with constant-time verification.
  - Dual JWT (`15m` access + `7d` refresh) delivered strictly via `HttpOnly`, `SameSite=Strict` cookies.
  - Global `RedisModule` (`ioredis`) managing refresh session rotation (`refresh_token:<userId>:<sessionId>`) and replay revocation.
  - Security hardening: `helmet`, `cookie-parser`, strict CORS, `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`), `ClassSerializerInterceptor` (`UserResponseEntity` with `@Exclude()`), and Redis-backed `@nestjs/throttler` rate limiting.
  - Frontend `apiClient` (`withCredentials: true`, 401 silent refresh interceptor), `AuthContext`, and responsive `AuthModal`.
- [x] Obsidian documentation vault updated with `docs/API_CONTRACT.md`.
- [x] Auth unit (`auth.service.spec.ts`) & e2e (`test/auth.e2e-spec.ts`) test suites added and passing (`feat/auth-tests`).
- [x] Google OAuth 2.0 login & registration (`feat/google-oauth`): `GoogleStrategy`, `GoogleAuthGuard`, verified-email account linking, auto-generated unique usernames, `HttpOnly` cookie session issuance, and frontend "Continue with Google" flow.

## Tasks In Progress
- [ ] Phase 2: Sample anime dataset seeding (`feat/db-seed`).

## Known Issues / Tech Debt
- Offline scripts in `scripts/` require `GEMINI_API_KEY` in `.env` before live batch execution.
