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
- **Active Branch:** `dev` (merged `feat/auth`, `feat/auth-tests`, `feat/google-oauth`, `feat/otp-password-reset`, `feat/anime-data-and-ai`, `feat/solo-game-mvp`, `feat/full-catalog-and-gameplay-fixes`, `feat/popularity-progression`, `fix/ai-clue-quality`, `fix/ai-env-and-translation`, `fix/popular-anime-pool`, `fix/db-gaps-and-clean-clues`)
- **Latest Release Branch:** `main` (initial scaffolding synced)
- **CI Pipeline:** `.github/workflows/ci.yml` configured for `main`, `dev`, and `feat/**`
- **Database Status:** Prisma migrations through `add_anime_popularity` applied (`30,549` catalog rows, `Anime.popularity` indexed, `pg_trgm` & all 6 GIN indexes active). Run `npm run catalog:sync-popularity` in `backend/` to backfill top 2,000 AniList metadata & popularity scores.

## Completed Milestones
- [x] Repository architecture, Docker Compose (PostgreSQL 16 `pg_trgm` + Redis 7), and NestJS modular monolith scaffolded.
- [x] Production Auth (`feat/auth`, `feat/auth-tests`), Google OAuth 2.0 (`feat/google-oauth`), and SMTP Email OTP Verification & Password Reset (`feat/otp-password-reset`).
- [x] 3-Source Anime Data Pipeline, On-the-Fly AI Clue Generator, Multilingual Autocomplete & i18n (`feat/anime-data-and-ai`).
- [x] Core Solo Game Loop & Minimalist Frontend Test Bench (`feat/solo-game-mvp`).
- [x] Full Catalog Importer, Lazy Enrichment, Search Fixes & Strict AI Clue Rules (`feat/full-catalog-and-gameplay-fixes`).
- [x] Popularity-Based Streak Difficulty Progression & Top-2,000 Metadata Backfill (`feat/popularity-progression`, `fix/popular-anime-pool`, `fix/db-gaps-and-clean-clues`):
  - Upgraded `scripts/sync_popularity.py` (`npm run catalog:sync-popularity`) to fetch 40 pages x 50 (**top 2,000**) AniList titles with `popularity`, `titleEn`, `titleJa`, `year`, `type`, `synonyms`, and sanitized base `dossier` (`genres`, `studios`, `description`).
  - Restricted early streaks in `AnimeService.getRandomAnime` to `popularity > 0` mainstream hits (`<4`: top 100 `TV/MOVIE`, `<10`: top 400 `TV/MOVIE`, `<20`: top 1,500, `>=20`: full 30k+ catalog).
- [x] AI Clue Quality, Sanitization & Translation (`fix/ai-clue-quality`, `fix/ai-env-and-translation`, `fix/db-gaps-and-clean-clues`):
  - Added `cleanScrapedText` stripping HTML, `(Source: ...)`, and Wikipedia `(Japanese: ..., Hepburn: ...)` headers across AniList/Wikipedia/Fandom.
  - Hardened fenced JSON parsing, `console.error`/`logger.error` diagnostics, automatic Redis purge of stale fallback/`[***]` cache entries, and natural localized title replacement with zero `[***]` placeholders.

## Tasks In Progress
- [ ] Phase 4: Telegram-chat styled game UI & Leaderboard view.

## Known Issues / Tech Debt
- Ensure valid `GROQ_API_KEY` (and optional `GEMINI_API_KEY`) are set in `backend/.env` for live LLM clue generation.
- Install Python dependencies (`pip install -r scripts/requirements.txt`) before running `npm run catalog:import` or `npm run catalog:sync-popularity`.
