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
- **Active Branch:** `dev` (merged `feat/auth`, `feat/auth-tests`, `feat/google-oauth`, `feat/otp-password-reset`, `feat/anime-data-and-ai`, `feat/solo-game-mvp`)
- **Latest Release Branch:** `main` (initial scaffolding synced)
- **CI Pipeline:** `.github/workflows/ci.yml` configured for `main`, `dev`, and `feat/**`
- **Database Status:** Prisma migrations `add_user_auth`, `add_google_oauth`, `add_email_verification`, & `add_anime_dossier_and_trgm` applied (`User` with `currentStreak`, `maxStreak`, `rating`; `Anime.dossier` JSONB + PostgreSQL `pg_trgm` GIN indexes). Seeded via `npx prisma db seed`.

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
  - Built `scripts/fetch_anime_data.py` (AniList + Wikidata + Wikipedia + Fandom), `scripts/custom_titles.txt`, `data/anime_dossiers.json`, and `backend/prisma/seed.ts`.
  - Implemented `GET /api/anime/search?q=<query>` and `AnimeService.getRandomAnime(excludeIds)`.
  - Implemented `AiModule` & `AiClueService` (Groq `llama-3.3-70b-versatile` primary -> Gemini `gemini-2.5-flash` fallback -> Redis emergency backup), Frontend `LanguageContext` (`UA | EN | RU`), and `AnimeAutocompleteInput`.
- [x] Core Solo Game Loop & Minimalist Frontend Test Bench (`feat/solo-game-mvp`):
  - Redis-backed solo game engine (`game:solo:<userId>`, 2h TTL, 15-item `recentAnimeIds` history, background next-round pre-warming) protected by `JwtAuthGuard`.
  - Endpoints `POST /api/game/start`, `POST /api/game/guess` (step-based scoring `+30/+20/+10`, streak & `maxStreak` persistence, non-destructive wrong guesses on steps `1..5`), and `POST /api/game/give-up`.
  - Built `frontend/src/pages/SoloGameTest.tsx` with live `Streak` / `Best Streak` / `Rating` top bar, difficulty-badged clue cards (`HARD`, `MEDIUM`, `EASY`), guess/skip/give-up controls, wrong-guess history, and full round result card.

## Tasks In Progress
- [ ] Phase 4: Telegram-chat styled game UI & Leaderboard view.

## Known Issues / Tech Debt
- Set `GROQ_API_KEY` and `GEMINI_API_KEY` in `backend/.env` for live LLM clue generation (falls back to Redis cache / dossier synthesis when keys are absent).
