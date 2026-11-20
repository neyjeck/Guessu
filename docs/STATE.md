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
- **Active Branch:** `dev` (merged `feat/auth`, `feat/auth-tests`, `feat/google-oauth`, `feat/otp-password-reset`, `feat/anime-data-and-ai`, `feat/solo-game-mvp`, `feat/full-catalog-and-gameplay-fixes`, `feat/popularity-progression`)
- **Latest Release Branch:** `main` (initial scaffolding synced)
- **CI Pipeline:** `.github/workflows/ci.yml` configured for `main`, `dev`, and `feat/**`
- **Database Status:** Prisma migrations through `add_anime_popularity` applied (`Anime.popularity` indexed with `@@index([popularity])`, `pg_trgm` extension & all 6 GIN indexes active). Run `npm run catalog:import` in `backend/` to load/update the 15,000+ catalog with AniList popularity scores.

## Completed Milestones
- [x] Repository architecture, Docker Compose (PostgreSQL 16 `pg_trgm` + Redis 7), and NestJS modular monolith scaffolded.
- [x] Production Auth (`feat/auth`, `feat/auth-tests`), Google OAuth 2.0 (`feat/google-oauth`), and SMTP Email OTP Verification & Password Reset (`feat/otp-password-reset`).
- [x] 3-Source Anime Data Pipeline, On-the-Fly AI Clue Generator, Multilingual Autocomplete & i18n (`feat/anime-data-and-ai`).
- [x] Core Solo Game Loop & Minimalist Frontend Test Bench (`feat/solo-game-mvp`).
- [x] Full Catalog Importer, Lazy Enrichment, Search Fixes & Strict AI Clue Rules (`feat/full-catalog-and-gameplay-fixes`):
  - `scripts/import_full_catalog.py` (`npm run catalog:import`), `AnimeEnrichmentService.ensureEnriched` (parallel AniList/Wikipedia/Fandom with 4s timeout), NULL-safe `pg_trgm` top-15 search, 30-item Redis history, strict `ai_clues:<animeId>:<lang>` & HARD/MEDIUM/EASY clue rules.
- [x] Popularity-Based Streak Difficulty Progression (`feat/popularity-progression`):
  - Added indexed `Anime.popularity` (`Int @default(0)`) via `add_anime_popularity` migration and bulk aliased AniList GraphQL popularity fetching (50 IDs/request) in `scripts/import_full_catalog.py`.
  - Updated `AnimeService.getRandomAnime(excludeIds, currentStreak)` and `GameService.startRound()` to scale selection pools by streak (`<4`: top 150, `<10`: top 600, `<20`: top 2000, `>=20`: full catalog) while excluding the last 30 played IDs and validating tier parity on pre-warmed rounds.

## Tasks In Progress
- [ ] Phase 4: Telegram-chat styled game UI & Leaderboard view.

## Known Issues / Tech Debt
- Set `GROQ_API_KEY` and `GEMINI_API_KEY` in `backend/.env` for live LLM clue generation (falls back to Redis cache / localized dossier synthesis when keys are absent).
- Install Python dependencies (`pip install -r scripts/requirements.txt`) before running `npm run catalog:import`.
