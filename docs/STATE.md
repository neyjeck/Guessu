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
- **Active Branch:** `dev` (merged `feat/auth`, `feat/auth-tests`, `feat/google-oauth`, `feat/otp-password-reset`, `feat/anime-data-and-ai`, `feat/solo-game-mvp`, `feat/full-catalog-and-gameplay-fixes`, `feat/popularity-progression`, `fix/ai-clue-quality`)
- **Latest Release Branch:** `main` (initial scaffolding synced)
- **CI Pipeline:** `.github/workflows/ci.yml` configured for `main`, `dev`, and `feat/**`
- **Database Status:** Prisma migrations through `add_anime_popularity` applied (`Anime.popularity` indexed with `@@index([popularity])`, `pg_trgm` extension & all 6 GIN indexes active). Run `npm run catalog:import` in `backend/` to load/update the 15,000+ catalog with AniList popularity scores.

## Completed Milestones
- [x] Repository architecture, Docker Compose (PostgreSQL 16 `pg_trgm` + Redis 7), and NestJS modular monolith scaffolded.
- [x] Production Auth (`feat/auth`, `feat/auth-tests`), Google OAuth 2.0 (`feat/google-oauth`), and SMTP Email OTP Verification & Password Reset (`feat/otp-password-reset`).
- [x] 3-Source Anime Data Pipeline, On-the-Fly AI Clue Generator, Multilingual Autocomplete & i18n (`feat/anime-data-and-ai`).
- [x] Core Solo Game Loop & Minimalist Frontend Test Bench (`feat/solo-game-mvp`).
- [x] Full Catalog Importer, Lazy Enrichment, Search Fixes & Strict AI Clue Rules (`feat/full-catalog-and-gameplay-fixes`).
- [x] Popularity-Based Streak Difficulty Progression (`feat/popularity-progression`): indexed `Anime.popularity`, aliased 50-ID AniList bulk popularity import, and streak-scaled pools (`<4`: 150, `<10`: 600, `<20`: 2000, `>=20`: full catalog).
- [x] AI Clue Quality & Provider Diagnostics (`fix/ai-clue-quality`):
  - Upgraded `AiClueService` error logging (`logger.error` with HTTP status/body & startup provider check), stopped caching offline fallbacks into Redis, and enriched dossiers with `seasonYear` + `studios`.
  - Rewrote LLM system/user prompts to ban generic genre/tag templates, enforce strict 6-step progression (Clues 1–2 trivia/rules, Clues 3–4 core plot premise without main names, Clue 5 turning points/main names, Clue 6 unmistakable giveaway with year/studio/premise/main names), and upgraded offline fallback to use real plot sentences, characters, year, and studio.

## Tasks In Progress
- [ ] Phase 4: Telegram-chat styled game UI & Leaderboard view.

## Known Issues / Tech Debt
- Ensure valid `GROQ_API_KEY` and/or `GEMINI_API_KEY` are set in `backend/.env` for live LLM clue generation.
- Install Python dependencies (`pip install -r scripts/requirements.txt`) before running `npm run catalog:import`.
