---
tags:
  - backlog
  - roadmap
  - anime-guesser
---

# Development Backlog

← Back to [[INDEX]] | Current progress: [[STATE]] | Vision: [[VISION]]

## Phase 1: Foundation & Scaffolding (Completed)
- [x] Initialize monorepo directory layout (`backend`, `frontend`, `scripts`, `data`, `docs`).
- [x] Configure `docker-compose.yml` with `postgres:16-alpine` (`pg_trgm`) and `redis:7-alpine`.
- [x] Define `backend/prisma/schema.prisma` (`User`, `Anime`, `GameSession`).
- [x] Scaffold NestJS modules (`auth`, `users`, `anime`, `game`, `leaderboard`).
- [x] Scaffold Vite + React + TypeScript frontend (`lucide-react`, `axios`).
- [x] Configure GitHub Actions CI (`.github/workflows/ci.yml`).
- [x] Create Obsidian documentation vault in `docs/`.

## Phase 2: Data Pipeline & Search Engine
- [ ] Run initial Prisma migration and create GIN `pg_trgm` indexes on `Anime` title columns.
- [ ] ImplementAniList + Wikidata fetcher in `scripts/fetch_anime.py` for top 500 anime with EN/Romaji/JA/UK/RU titles.
- [ ] Implement Gemini progressive clue generator in `scripts/generate_clues.py`.
- [ ] Build Prisma database seed script (`backend/prisma/seed.ts`) reading from `data/seed_anime.json`.
- [ ] Tune `AnimeService.search()` with raw `pg_trgm` similarity ranking + fallback `ILIKE`.

## Phase 3: Core Single-Player Game Loop
- [ ] Finalize `GameService` session state machine (`CLUES`, `SCREENSHOT`, `ENDLESS` modes).
- [ ] Build interactive Clue Card and Frame Viewer components in `frontend/`.
- [ ] Build debounced Multilingual Autocomplete input component next to progressive clues.
- [ ] Implement ELO rating delta calculation and streak persistence in `GameService`.
- [ ] Add end-of-round summary modal with anime cover reveal and shareable result grid.

## Phase 4: Users, Customization & Leaderboards
- [ ] Implement JWT/OAuth authentication in `AuthModule`.
- [ ] Build User Profile page with customizable `avatarUrl`, `profileTheme`, and unlockable `badgeTitle`.
- [ ] Build Global Leaderboard view (`LeaderboardModule` + Redis caching) for top rating and top `maxStreak`.

## Phase 5: Real-Time Multiplayer & Mini-Games
- [ ] Integrate `@nestjs/websockets` and `socket.io` with Redis adapter.
- [ ] Implement 1v1 real-time duel matchmaking queue and synchronized clue reveal timers.
- [ ] Add bonus mini-games (Release Year / Studio guessing, Opening theme audio snippet mode).
