# Anime Guesser

Fullstack competitive anime deduction web game built as a modular monolith with **NestJS**, **React (Vite + TypeScript)**, **PostgreSQL (`pg_trgm`)**, and **Redis**.

## Project Structure

- `backend/` — NestJS + TypeScript API server with Prisma ORM (`auth`, `users`, `anime`, `game`, `leaderboard`)
- `frontend/` — Vite + React + TypeScript web client (`lucide-react`, `axios`)
- `scripts/` — Offline Python data collection & Gemini AI progressive clue generator
- `data/` — Intermediate JSON dumps for database seeding
- `docs/` — Obsidian documentation vault (`docs/INDEX.md`)
- `.github/workflows/ci.yml` — GitHub Actions CI pipeline

## Quick Start

### 1. Start Infrastructure (PostgreSQL 16 + Redis 7)
```bash
docker compose up -d
```

### 2. Backend Setup
```bash
cd backend
cp .env.example .env
npm install
npx prisma generate
npm run start:dev
```

### 3. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```

## Documentation
Open `docs/` as an Obsidian vault, starting at [`docs/INDEX.md`](docs/INDEX.md).
