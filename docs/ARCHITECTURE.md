---
tags:
  - architecture
  - backend
  - database
  - security
  - anime-guesser
---

# System Architecture

← Back to [[INDEX]] | Related: [[VISION]], [[STATE]]

## 1. Modular Monolith Overview

Anime Guesser uses a **NestJS Modular Monolith** architecture inside `backend/`. Each domain is encapsulated in its own module with explicit boundaries, DTO validation (`class-validator` + `class-transformer`), and shared database access via `PrismaService`.

```
backend/src/
├── prisma/        # Global PrismaModule & PrismaService
├── auth/          # Authentication endpoints & session/token orchestration
├── users/         # User profile CRUD, avatars, themes, titles, streak stats
├── anime/         # Multilingual anime catalog & pg_trgm fuzzy search
├── game/          # Session lifecycle, clue/frame reveal, anti-cheat verification
└── leaderboard/   # Global rating & maxStreak ranking queries
```

## 2. Database Schema & `pg_trgm` Fuzzy Search

PostgreSQL 16 is the primary relational store, initialized with the `pg_trgm` extension (`docker/postgres/init.sql`).

### Core Models (`backend/prisma/schema.prisma`)
- **`User`**: Stores identity (`username`, `email`), cosmetics (`avatarUrl`, `profileTheme`, `badgeTitle`), competitive rating (`rating`, default `1000`), and streak counters (`currentStreak`, `maxStreak`).
- **`Anime`**: Stores external IDs (`anilistId`, `malId`), localized titles (`titleEn`, `titleRomaji`, `titleJa`, `titleUk`, `titleRu`), `synonyms` (`String[]`), `coverUrl`, `screenshots` (`String[]`), and structured `clues` (`Json`).
- **`GameSession`**: Tracks active and completed games (`mode`: `CLUES | SCREENSHOT | ENDLESS`, `status`: `IN_PROGRESS | WON | LOST`, `targetAnimeId`, `currentStep`, `attempts`).

### Multilingual Trigram Search Strategy
- Queries match user input against `titleEn`, `titleRomaji`, `titleJa`, `titleUk`, `titleRu`, and `synonyms`.
- GIN trigram indexes (`gin_trgm_ops`) accelerate `SIMILARITY()` and `ILIKE` queries so players receive sub-50ms autocomplete suggestions regardless of script or minor spelling errors.

## 3. Anti-Cheat & Zero Answer Leakage

A critical design requirement in `GameModule`:
1. **Server-Authoritative State:** When a player starts a `GameSession`, `targetAnimeId` remains strictly on the server.
2. **Step-Gated Payload:** The API returns only the `sessionId`, `mode`, `currentStep`, `attempts`, and the subset of clues (`clues[0..currentStep]`) or screenshots (`screenshots[0..currentStep]`) unlocked so far.
3. **Server-Side Guess Verification:** The client submits `{ guessedAnimeId }` to `POST /api/game/:sessionId/guess`. The server compares `guessedAnimeId === session.targetAnimeId`:
   - **Correct:** Marks session `WON`, increments `currentStreak` (and updates `maxStreak`), adjusts `rating`, and reveals full anime metadata.
   - **Incorrect:** Increments `attempts` and `currentStep`. If `currentStep` exceeds maximum steps, marks session `LOST`, resets `currentStreak` to `0`, and reveals the answer.

## 4. Offline Data Pipeline (`scripts/` & `data/`)

To keep runtime latency minimal and eliminate live LLM costs/hallucinations during gameplay:
1. `scripts/fetch_anime.py` fetches anime metadata from AniList GraphQL and localized UK/RU titles from Wikidata, writing to `data/`.
2. `scripts/fetch_screenshots.py` collects curated episode frames.
3. `scripts/generate_clues.py` prompts the Gemini API to produce 5 progressive, non-cliché clues per anime.
4. Validated JSON artifacts in `data/` are seeded into PostgreSQL.

## 5. Redis & WebSocket Scalability

- **Redis (`redis:7-alpine`):** Provisioned for leaderboard caching, rate limiting, and future real-time 1v1 duel matchmaking queues.
- **Socket.io Readiness:** Modular boundaries allow adding a `DuelGateway` in `GameModule` backed by the Redis adapter without restructuring existing HTTP services.
