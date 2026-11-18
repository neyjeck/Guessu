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
- **Active Branch:** `dev` (merged `feat/auth`, `feat/auth-tests`, `feat/google-oauth`, `feat/otp-password-reset`, `feat/anime-data-and-ai`)
- **Latest Release Branch:** `main` (initial scaffolding synced)
- **CI Pipeline:** `.github/workflows/ci.yml` configured for `main`, `dev`, and `feat/**`
- **Database Status:** Prisma migrations `add_user_auth`, `add_google_oauth`, `add_email_verification`, & `add_anime_dossier_and_trgm` applied (`Anime.dossier` JSONB + PostgreSQL `pg_trgm` GIN indexes on `titleRomaji`, `titleEn`, `titleJa`, `titleUk`, `titleRu` + GIN on `synonyms`). Seeded via `npx prisma db seed`.

## Completed Milestones
- [x] Repository directory architecture initialized (`backend`, `frontend`, `scripts`, `data`, `docs`, `.github`).
- [x] Root `docker-compose.yml` configured with PostgreSQL 16 (`pg_trgm` init script) and Redis 7.
- [x] NestJS modular monolith scaffolded (`PrismaModule`, `RedisModule`, `AuthModule`, `UsersModule`, `AnimeModule`, `AiModule`, `GameModule`, `LeaderboardModule`).
- [x] Production-grade Authentication & Registration (`feat/auth`, `feat/auth-tests`):
  - `argon2id` hashing, dual JWT (`15m` access + `7d` refresh) in `HttpOnly`, `SameSite=Strict` cookies, Redis session rotation & replay detection, unit + e2e tests.
- [x] Google OAuth 2.0 login & registration (`feat/google-oauth`).
- [x] Real SMTP Email OTP Verification & Password Reset (`feat/otp-password-reset`): `MailModule` (`nodemailer`), `OtpService` (SHA-256 OTPs in Redis, 10m TTL, 60s cooldown, 3-attempt lockout, atomic SMTP rollback).
- [x] 3-Source Anime Data Pipeline, On-the-Fly AI Clue Generator, Multilingual Autocomplete & i18n (`feat/anime-data-and-ai`):
  - Replaced static `Anime.clues` with `Anime.dossier` (`Json`) and added `pg_trgm` GIN indexes (`add_anime_dossier_and_trgm`).
  - Built `scripts/fetch_anime_data.py` (AniList GraphQL + Wikidata SPARQL `P8729`/`P4086` + Wikipedia & Fandom MediaWiki APIs), `scripts/custom_titles.txt`, `data/anime_dossiers.json`, and `backend/prisma/seed.ts`.
  - Implemented `GET /api/anime/search?q=<query>` (min 2 chars, top 10 substring + trigram ranked matches across EN/Romaji/UK/RU/JA/synonyms) and `AnimeService.getRandomAnime(excludeIds)`.
  - Implemented `AiModule` & `AiClueService` (`llama-3.3-70b-versatile` on Groq primary -> `gemini-2.5-flash` fallback -> Redis emergency backup per `(animeId, lang)`), generating 6 native clues (`{ hard, medium, easy }`) on the fly at `temperature: 0.9`.
  - Added Frontend `LanguageContext` (`uk` / `en` / `ru` with `localStorage` persistence), navbar `UA | EN | RU` switcher, and debounced (200ms) `AnimeAutocompleteInput` with cover thumbnails, substring highlighting, and keyboard navigation (`ArrowUp`/`ArrowDown`/`Enter`/`Escape`).

## Tasks In Progress
- [ ] Phase 3: Full interactive clue & screenshot round gameplay loop UI (`feat/gameplay-loop`).

## Known Issues / Tech Debt
- Set `GROQ_API_KEY` and `GEMINI_API_KEY` in `backend/.env` for live LLM clue generation (falls back to Redis cache / dossier synthesis when keys are absent).
