---
tags:
  - vision
  - product
  - gameplay
  - anime-guesser
---

# Product Vision — Anime Guesser

← Back to [[INDEX]] | Related: [[ARCHITECTURE]], [[BACKLOG]]

## Overview

**Anime Guesser** is a fast-paced, replayable anime trivia and deduction web game designed for both casual viewers and seasoned anime enthusiasts. Unlike static trivia quizzes that rely on obvious plot summaries or easily searchable character names, Anime Guesser emphasizes lateral thinking, visual recognition, and smooth multilingual input.

## Core Pillars

### 1. Progressive Non-Cliché AI Clues
- Placed directly adjacent to the search input field for rapid eye-scanning during gameplay.
- Generated offline via the Gemini API (`scripts/`) and curated before seeding into PostgreSQL.
- **Anti-Cliché Philosophy:** Early clues describe atmospheric details, recurring visual motifs, narrative structure, or world-building mechanics without naming protagonists, signature attacks, or studio names until later steps.
- Up to 5 progressive clues per round: starting cryptic (high reward) and becoming more explicit with each wrong attempt or skip.

### 2. Typo-Tolerant Multilingual Fuzzy Search
- Players think of anime titles in different languages and transliterations.
- Instant autocomplete supports **English (EN)**, **Romaji / Japanese (JA)**, **Ukrainian (UK)**, **Russian (RU)**, and common community **synonyms/abbreviations**.
- Powered by PostgreSQL `pg_trgm` trigram similarity so minor typos (e.g., *"Shingeki no Kyojni"*, *"Атака титанів"*, *"Frieren"*) still surface the intended series immediately.

### 3. Game Modes
- **Progressive Clues Mode (`CLUES`):** Deduce the hidden anime across 5 escalating text clues.
- **Screenshot / Frame Mode (`SCREENSHOT`):** Identify the anime from progressively less-obscured or increasingly recognizable frames from actual episodes.
- **Endless Streak Mode (`ENDLESS`):** Survival mode where a single failure resets the current run; tracks `currentStreak` and all-time `maxStreak`.

### 4. Competitive Progression & Customization
- **Rating & Streaks:** ELO-style rating (`default: 1000`) alongside live and best guessing streaks.
- **Global Leaderboard:** Ranked leaderboards filterable by overall rating and longest streaks.
- **Profile Customization:** Unlockable and customizable avatars (`avatarUrl`), profile themes/frames (`profileTheme`), and prestige titles (`badgeTitle`).

### 5. Future Real-Time Multiplayer & Mini-Games
- **1v1 Real-Time Duels:** Head-to-head WebSocket matches via Socket.io and Redis pub/sub state synchronization.
- **Party / Mini-Game Modes:** Speed rounds, soundtrack/opening snippets, and studio/year higher-lower challenges.
