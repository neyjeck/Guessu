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
- **Active Branch:** `dev` (merged `feat/auth`, `feat/auth-tests`, `feat/google-oauth`, `feat/otp-password-reset`, `feat/anime-data-and-ai`, `feat/solo-game-mvp`, `feat/full-catalog-and-gameplay-fixes`)
- **Latest Release Branch:** `main` (initial scaffolding synced)
- **CI Pipeline:** `.github/workflows/ci.yml` configured for `main`, `dev`, and `feat/**`
- **Database Status:** Prisma migrations through `full_anime_catalog_and_fixes` applied (`Anime` expanded with `type`, `year`, `tags`, `isEnriched`, nullable `anilistId`/`titleRomaji`/`coverUrl`/`dossier`; `pg_trgm` extension & all 6 GIN indexes verified active). Run `npm run catalog:import` in `backend/` to load the 15,000+ catalog.

## Completed Milestones
- [x] Repository architecture, Docker Compose (PostgreSQL 16 `pg_trgm` + Redis 7), and NestJS modular monolith scaffolded.
- [x] Production Auth (`feat/auth`, `feat/auth-tests`), Google OAuth 2.0 (`feat/google-oauth`), and SMTP Email OTP Verification & Password Reset (`feat/otp-password-reset`).
- [x] 3-Source Anime Data Pipeline, On-the-Fly AI Clue Generator, Multilingual Autocomplete & i18n (`feat/anime-data-and-ai`).
- [x] Core Solo Game Loop & Minimalist Frontend Test Bench (`feat/solo-game-mvp`): Redis-backed rounds (`game:solo:<userId>`), step scoring (`+30/+20/+10`), streaks, and `SoloGameTest.tsx`.
- [x] Full Catalog Importer, Lazy Enrichment, Search Fixes & Strict AI Clue Rules (`feat/full-catalog-and-gameplay-fixes`):
  - Expanded `Anime` Prisma schema (`type`, `year`, `tags`, `isEnriched`, nullable catalog fields) and applied `full_anime_catalog_and_fixes` migration preserving `pg_trgm` + GIN indexes.
  - Added `scripts/import_full_catalog.py` (`npm run catalog:import`) downloading `anime-offline-database-minified.json`, filtering valid formats/non-adult tags, batch-enriching `uk`/`ru`/`en` labels from Wikidata SPARQL (`P4086`/`P8729`), and bulk-upserting via `psycopg2.extras.execute_values`.
  - Built `AnimeEnrichmentService.ensureEnriched` (parallel AniList + Wikipedia + Fandom fetch with strict 4s timeout per request, persisted to PostgreSQL) invoked in `GameService` before clue generation.
  - Fixed NULL-safe `AnimeService.search` (`COALESCE`, `array_to_string(synonyms, ' ')`, `ILIKE` + `SIMILARITY > 0.15`, prefix -> substring -> trigram ranking, top 15 results) and `getRandomAnime` (requiring non-null `coverUrl` & `anilistId`, 30-item Redis recent history window).
  - Enforced strict AI clue language sync (`SoloGameTest.tsx` explicit `{ lang }`, Redis `ai_clues:<animeId>:<lang>`, Cyrillic check for `uk`/`ru`) and strict HARD/MEDIUM/EASY tier rules (no main character names in HARD/MEDIUM, 6 completely distinct non-repeating clues).

## Tasks In Progress
- [ ] Phase 4: Telegram-chat styled game UI & Leaderboard view.

## Known Issues / Tech Debt
- Set `GROQ_API_KEY` and `GEMINI_API_KEY` in `backend/.env` for live LLM clue generation (falls back to Redis cache / localized dossier synthesis when keys are absent).
- Install Python dependencies (`pip install -r scripts/requirements.txt`) before running `npm run catalog:import`.
