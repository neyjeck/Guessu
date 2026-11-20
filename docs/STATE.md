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
- **Active Branch:** `dev` (merged `feat/auth`, `feat/auth-tests`, `feat/google-oauth`, `feat/otp-password-reset`, `feat/anime-data-and-ai`, `feat/solo-game-mvp`, `feat/full-catalog-and-gameplay-fixes`, `feat/popularity-progression`, `fix/ai-clue-quality`, `fix/ai-env-and-translation`, `fix/popular-anime-pool`, `fix/db-gaps-and-clean-clues`, `feat/franchise-root-only`, `fix/ai-token-budget-and-models`, `fix/ai-json-resilience`, `feat/profile-and-settings`)
- **Latest Release Branch:** `main` (initial scaffolding synced)
- **CI Pipeline:** `.github/workflows/ci.yml` configured for `main`, `dev`, and `feat/**`
- **Database Status:** Prisma migrations through `add_user_profile_and_settings` applied (`User` profile/favorites/theme/privacy/gamesPlayed/gamesWon fields, `Anime.isSequel` & `Anime.popularity` indexed, `pg_trgm` & all 6 GIN indexes active).

## Completed Milestones
- [x] Repository architecture, Docker Compose (PostgreSQL 16 `pg_trgm` + Redis 7), and NestJS modular monolith scaffolded.
- [x] Production Auth (`feat/auth`, `feat/auth-tests`), Google OAuth 2.0 (`feat/google-oauth`), and SMTP Email OTP Verification & Password Reset (`feat/otp-password-reset`).
- [x] 3-Source Anime Data Pipeline, On-the-Fly AI Clue Generator, Multilingual Autocomplete & i18n (`feat/anime-data-and-ai`).
- [x] Core Solo Game Loop & Minimalist Frontend Test Bench (`feat/solo-game-mvp`).
- [x] Full Catalog Importer, Lazy Enrichment, Search Fixes & Strict AI Clue Rules (`feat/full-catalog-and-gameplay-fixes`).
- [x] Popularity-Based Streak Difficulty Progression & Top-2,000 Metadata Backfill (`feat/popularity-progression`, `fix/popular-anime-pool`, `fix/db-gaps-and-clean-clues`).
- [x] AI Clue Quality, Sanitization, Translation & Token Optimization (`fix/ai-clue-quality`, `fix/ai-env-and-translation`, `fix/db-gaps-and-clean-clues`, `fix/ai-token-budget-and-models`, `fix/ai-json-resilience`).
- [x] Franchise Root-Only Selection & Forgiving Sequel Guessing (`feat/franchise-root-only`).
- [x] Player Profile, Favorites Showcases, Avatar Upload & Settings (`feat/profile-and-settings`):
  - Extended `User` schema (`bio`, `favoriteAnime`, `favoriteCharacters`, `theme`, `isPublicProfile`, `showStats`, `showFavorites`, `gamesPlayed`, `gamesWon`) via `add_user_profile_and_settings` migration.
  - Added `GET /api/users/me`, `PATCH /api/users/me`, `POST /api/users/me/avatar` (Multer upload served at `/uploads/avatars/...`), and `GET /api/anime/characters/search` (AniList GraphQL proxy with in-memory + Redis caching).
  - Updated `GameService` / `UsersService.recordGameOutcome` to track `gamesPlayed` and `gamesWon` on round completion.
  - Built `ProfilePage.tsx` (avatar upload/URL, nickname, bio, 5-stat grid, 5-slot Favorite Anime & Favorite Character showcases with search modals) and `SettingsPage.tsx` (language switcher, 4 low-glare themes including `warm-parchment` `#E6E1D6`, and privacy controls) localized in `uk`, `en`, and `ru`.

## Tasks In Progress
- [ ] Phase 4: Telegram-chat styled game UI & Leaderboard view.

## Known Issues / Tech Debt
- Ensure valid `GROQ_API_KEY` (and optional `GEMINI_API_KEY`) are set in `backend/.env` for live LLM clue generation.
- Install Python dependencies (`pip install -r scripts/requirements.txt`) before running `npm run catalog:import` or `npm run catalog:sync-popularity`.
