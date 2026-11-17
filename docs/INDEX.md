---
tags:
  - hub
  - documentation
  - anime-guesser
---

# Anime Guesser — Knowledge Vault

Welcome to the Obsidian knowledge base for **Anime Guesser**, a competitive fullstack web game built as a modular monolith with **NestJS**, **React (Vite + TypeScript)**, **PostgreSQL (`pg_trgm`)**, and **Redis**.

## Core Navigation

- [[STATE]] — Current project state, active branch, completed milestones, database status, and open tasks (**read first in every session**).
- [[VISION]] — Product vision, core gameplay loops, progressive AI clue philosophy, multilingual search, and multiplayer roadmap.
- [[ARCHITECTURE]] — System design, NestJS modular monolith structure, Prisma data model, `pg_trgm` fuzzy search, and zero-leakage anti-cheat design.
- [[BACKLOG]] — Phased development roadmap (Phases 1 through 5).
- [[GIT_WORKFLOW]] — Git branching model (`main`, `dev`, `feat/*`, `fix/*`), CI pipeline, and Conventional Commits rules.

## Repository Map

| Directory | Purpose |
| :--- | :--- |
| `backend/` | NestJS + TypeScript modular monolith (`auth`, `users`, `anime`, `game`, `leaderboard`, `prisma`) |
| `frontend/` | Vite + React + TypeScript client (`lucide-react`, `axios`) |
| `scripts/` | Offline Python pipeline (AniList/Wikidata scraping, screenshot extraction, Gemini AI clue generator) |
| `data/` | Intermediate JSON dumps prior to PostgreSQL database seeding |
| `docs/` | Obsidian-ready documentation vault (strictly in English) |
| `.github/workflows/` | GitHub Actions CI (`ci.yml`) |
