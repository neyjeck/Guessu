---
tags:
  - api
  - auth
  - security
  - contract
  - anime-guesser
---

# API Contract — Authentication & Sessions

← Back to [[INDEX]] | Related: [[ARCHITECTURE]], [[STATE]]

## 1. Security & Cookie Architecture

Authentication in **Anime Guesser** uses a dual-token **JWT + Redis Session** strategy designed for zero client-side token exposure:

- **No Token Leakage in JSON or `localStorage`:** Both `access_token` and `refresh_token` are delivered exclusively via `HttpOnly`, `SameSite=Strict` cookies (`Secure=true` in production).
- **Short-Lived Access Token (`access_token`):**
  - **TTL:** `15m` (`900,000 ms`)
  - **Payload:** `{ sub: userId, username, role, type: "access" }`
- **Rotating Refresh Token (`refresh_token`) + Redis Session Store:**
  - **TTL:** `7d` (`604,800 s`)
  - **Payload:** `{ sub: userId, sessionId, type: "refresh" }`
  - **Redis Key:** `refresh_token:<userId>:<sessionId>` with a 7-day TTL.
  - **Rotation & Replay Detection:** Every call to `POST /api/auth/refresh` atomically deletes the old `sessionId` in Redis and issues a new `sessionId` and token pair. If a previously rotated or revoked `refresh_token` is presented, all active sessions for that user (`refresh_token:<userId>:*`) are immediately revoked.
- **Password Hashing:** `argon2id` (`argon2` package) with constant-time verification (including dummy hash verification when a username/email does not exist to prevent timing-based user enumeration).
- **Anti-Injection & Serialization:**
  - Global `ValidationPipe` with `{ whitelist: true, forbidNonWhitelisted: true, transform: true }`.
  - Global `ClassSerializerInterceptor` with `@Exclude()` on `passwordHash` in `UserResponseEntity`.
  - `helmet` HTTP security headers and Redis-backed `@nestjs/throttler` rate limiting (`5 req / 60s` per IP on `/api/auth/register` and `/api/auth/login`).

---

## 2. Shared Data Structures

### `UserResponseEntity` (Safe User Profile)

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "username": "otaku_detective",
  "email": "challenger@example.com",
  "isEmailVerified": false,
  "role": "USER",
  "avatarUrl": null,
  "profileTheme": "default",
  "badgeTitle": "Rookie Guesser",
  "rating": 1000,
  "currentStreak": 0,
  "maxStreak": 0,
  "createdAt": "2026-11-17T09:00:00.000Z",
  "updatedAt": "2026-11-17T09:00:00.000Z"
}
```

> **Note:** `passwordHash` and `googleId` are decorated with `@Exclude()` and are never serialized in any API response.

---

## 3. Endpoints

### `POST /api/auth/register`

Creates a new user account, initializes a 7-day Redis refresh session, sets `access_token` and `refresh_token` `HttpOnly` cookies, and returns the created user profile.

- **Rate Limit:** 5 requests / 60 seconds per IP.
- **Request Body (`RegisterDto`):**
  ```json
  {
    "username": "otaku_detective",
    "email": "challenger@example.com",
    "password": "Password123"
  }
  ```
  - `username`: 3–20 characters, trimmed, alphanumeric and underscores only (`/^[a-zA-Z0-9_]+$/`).
  - `email`: Valid email format, trimmed and normalized to lowercase.
  - `password`: 8–128 characters, must contain at least 1 uppercase letter, 1 lowercase letter, and 1 number.
- **Responses:**
  - `201 Created`: Returns `UserResponseEntity` and `Set-Cookie` headers for `access_token` and `refresh_token`.
  - `400 Bad Request`: Validation error (invalid fields or non-whitelisted properties).
  - `409 Conflict`: Username or email is already registered.
  - `429 Too Many Requests`: Rate limit exceeded.

---

### `POST /api/auth/login`

Authenticates an existing user by username or email using constant-time `argon2id` verification, creates a new Redis session, sets `HttpOnly` cookies, and returns the user profile.

- **Rate Limit:** 5 requests / 60 seconds per IP.
- **Request Body (`LoginDto`):**
  ```json
  {
    "login": "otaku_detective",
    "password": "Password123"
  }
  ```
  - `login`: Username or email address (trimmed, min 3 characters).
  - `password`: Plaintext password (min 8 characters).
- **Responses:**
  - `200 OK`: Returns `UserResponseEntity` and `Set-Cookie` headers for `access_token` and `refresh_token`.
  - `401 Unauthorized`: Invalid credentials.
  - `429 Too Many Requests`: Rate limit exceeded.

---

### `POST /api/auth/refresh`

Validates the `refresh_token` `HttpOnly` cookie against Redis, rotates the session ID in Redis (`refresh_token:<userId>:<sessionId>`), sets fresh `access_token` and `refresh_token` cookies, and returns the updated user profile.

- **Rate Limit:** 20 requests / 60 seconds per IP.
- **Cookies Required:** `refresh_token`
- **Responses:**
  - `200 OK`: Returns `UserResponseEntity` and rotated `Set-Cookie` headers.
  - `401 Unauthorized`: Missing, expired, or revoked refresh token (clears auth cookies and revokes all user sessions if replay is detected).

---

### `POST /api/auth/logout`

Deletes the active refresh session from Redis and clears both `access_token` and `refresh_token` cookies.

- **Cookies Read:** `refresh_token` (optional; cookies are cleared even if expired).
- **Responses:**
  - `200 OK`:
    ```json
    {
      "message": "Logged out successfully"
    }
    ```

---

### `GET /api/auth/me`

Returns the authenticated user's profile. Protected by `JwtAuthGuard`.

- **Cookies Required:** `access_token` (or `Authorization: Bearer <token>` header).
- **Responses:**
  - `200 OK`: Returns `UserResponseEntity`.
  - `401 Unauthorized`: Missing or expired `access_token`.

---

### `GET /api/auth/google`

Initiates the Google OAuth 2.0 login/registration flow via Passport (`passport-google-oauth20`), requesting `email` and `profile` scopes and redirecting (`302`) to Google's consent screen.

- **Responses:**
  - `302 Found`: Redirects to Google OAuth 2.0 consent screen.

---

### `GET /api/auth/google/callback`

Handles the Google OAuth 2.0 callback:

1. Looks up an existing user by `googleId`.
2. If not found, checks for an existing account by verified `email` and links `googleId` (plus `avatarUrl` if empty).
3. Otherwise creates a new account with an auto-generated sanitized unique `username` (`3–20` chars, `[a-zA-Z0-9_]`) and `passwordHash = null`.
4. Initializes a 7-day Redis refresh session, sets `HttpOnly`, `SameSite=Strict` `access_token` and `refresh_token` cookies, and redirects (`302`) to `FRONTEND_URL` (no tokens are ever passed in URL query parameters).
5. On failure or user cancellation, redirects (`302`) to `${FRONTEND_URL}?auth_error=google_cancelled|google_auth_failed`.

- **Required Backend Environment Variables:**
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_CALLBACK_URL` (e.g. `http://localhost:3000/api/auth/google/callback`)
  - `FRONTEND_URL` (e.g. `http://localhost:5173`)

---

### `POST /api/auth/verify-email`

Validates a 6-digit email verification OTP code against Redis (`otp:verify:<email>`), marks `User.isEmailVerified = true`, deletes the OTP from Redis, and returns the updated `UserResponseEntity`.

- **Rate Limit:** 3 requests / 60 seconds per IP.
- **Brute-Force Protection:** After 3 failed verification attempts, the OTP key in Redis is immediately invalidated and deleted.
- **Request Body (`VerifyEmailDto`):**
  ```json
  {
    "email": "challenger@example.com",
    "code": "482910"
  }
  ```
- **Responses:**
  - `200 OK`: Returns updated `UserResponseEntity` with `"isEmailVerified": true`.
  - `400 Bad Request`: Invalid, expired, or locked-out verification code.
  - `429 Too Many Requests`: Rate limit exceeded.

---

### `POST /api/auth/resend-verification`

Generates a new 6-digit verification OTP (`crypto.randomInt(100000, 999999)`), stores its SHA-256 hash in Redis (`otp:verify:<email>`, 10m TTL) with a 60-second resend cooldown (`otp_cooldown:verify:<email>`, 60s TTL), and dispatches the verification email via Nodemailer SMTP.

- **Rate Limit:** 3 requests / 60 seconds per IP.
- **Atomic Delivery Guarantee:** If `MailService` fails to send the email via SMTP, both the OTP and cooldown keys are immediately deleted from Redis and a `503 Service Unavailable` response is returned so the user can retry immediately.
- **Request Body (`ResendVerificationDto`):**
  ```json
  {
    "email": "challenger@example.com"
  }
  ```
- **Responses:**
  - `200 OK`: `{ "message": "Verification code has been sent to your email." }`
  - `400 Bad Request`: Account not found or already verified.
  - `429 Too Many Requests`: Cooldown active (60s) or IP rate limit exceeded.
  - `503 Service Unavailable`: SMTP delivery failure.

---

### `POST /api/auth/forgot-password`

Initiates the password reset flow.

- **Rate Limit:** 3 requests / 60 seconds per IP.
- **Anti-Enumeration Rule:** Always returns `200 OK` with `{ "message": "If an account with that email exists, a verification code has been sent." }` regardless of whether the email exists in PostgreSQL.
- **Behavior:**
  - If a local account exists (`passwordHash !== null`), generates a 6-digit reset OTP (`otp:reset:<email>`, 10m TTL, 60s cooldown) and sends the password reset email via SMTP.
  - If a Google OAuth-only account exists (`passwordHash === null`), sends a reminder email to sign in with Google.
- **Request Body (`ForgotPasswordDto`):**
  ```json
  {
    "email": "challenger@example.com"
  }
  ```

---

### `POST /api/auth/reset-password`

Verifies the 6-digit password reset OTP (`otp:reset:<email>`), hashes `newPassword` with `argon2id`, updates `User.passwordHash` and `User.isEmailVerified = true`, deletes the OTP from Redis, and **revokes all active refresh sessions (`refresh_token:<userId>:*`) in Redis** to force logout across all devices.

- **Rate Limit:** 3 requests / 60 seconds per IP.
- **Request Body (`ResetPasswordDto`):**
  ```json
  {
    "email": "challenger@example.com",
    "code": "839201",
    "newPassword": "NewSecurePassword123"
  }
  ```
- **Responses:**
  - `200 OK`: `{ "message": "Password has been reset successfully. Please sign in with your new password." }`
  - `400 Bad Request`: Invalid/expired OTP, 3-attempt lockout triggered, or weak password.
  - `429 Too Many Requests`: Rate limit exceeded.

- **Required SMTP Environment Variables (`backend/.env`):**
  - `SMTP_HOST` (e.g. `smtp.gmail.com`)
  - `SMTP_PORT` (e.g. `587` or `465`)
  - `SMTP_SECURE` (`true` for 465, `false` for 587)
  - `SMTP_USER`
  - `SMTP_PASS`
  - `SMTP_FROM` (e.g. `"Anime Guesser <no-reply@animeguesser.local>"`)
  - `OTP_HASH_SECRET`

---

## 4. Frontend Silent Refresh Flow (`frontend/src/api/client.ts`)

1. All Axios requests run with `withCredentials: true`.
2. When any protected API request returns `401 Unauthorized` (excluding `/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/logout`), the response interceptor triggers a shared `POST /api/auth/refresh` request.
3. Upon successful token rotation, the browser updates its `HttpOnly` cookies and Axios transparently retries the original request once (`_retry = true`).
4. If `POST /api/auth/refresh` fails with `401`, the user state in `AuthContext` resets to `null` (Guest mode).

---

## 5. Full Catalog, Lazy Enrichment & Multilingual Search (`AnimeModule`)

### Full Catalog Importer (`scripts/import_full_catalog.py`)

Run `npm run catalog:import` inside `backend/` (wraps `python3 ../scripts/import_full_catalog.py`) to download `anime-offline-database-minified.json`, filter valid formats (`TV`, `MOVIE`, `OVA`, `ONA`, `SPECIAL`) excluding adult tags (`hentai`, `erotica`) and `MUSIC`, batch-enrich `uk` / `ru` / `en` labels from Wikidata SPARQL (`wdt:P4086` / `wdt:P8729`), and bulk-upsert 15,000+ records into PostgreSQL via `psycopg2.extras.execute_values` while preserving existing enriched dossiers.

### Lazy On-Demand Enrichment (`AnimeEnrichmentService.ensureEnriched`)

Called automatically in `GameService.startSoloRound()` and background round pre-warming before clue generation:
- Returns immediately if `anime.isEnriched === true` and `anime.dossier` is populated.
- Otherwise fetches in parallel with a strict **4-second timeout** per external source:
  1. **AniList GraphQL API** (by `anilistId` or title): `title.english`, `title.native`, `description`, `genres`, top `tags`, and main/supporting `characters`.
  2. **Wikipedia API**: plot summary and fallback `uk`/`ru` interlanguage titles.
  3. **Fandom MediaWiki API**: `Trivia`, memes, quotes, and character quirks.
- Saves `dossier`, `titleEn`, `titleJa`, and `isEnriched: true` back to PostgreSQL for instant reuse on subsequent games.

### `GET /api/anime/search?q=<query>&limit=15`

Performs NULL-safe case-insensitive substring (`ILIKE '%q%'`) + PostgreSQL `pg_trgm` trigram similarity (`SIMILARITY(...) > 0.15`) matching across `COALESCE(titleEn, '')`, `COALESCE(titleRomaji, '')`, `COALESCE(titleUk, '')`, `COALESCE(titleRu, '')`, `COALESCE(titleJa, '')`, and `array_to_string(synonyms, ' ')`.

- **Query Parameters (`SearchAnimeDto`):**
  - `q`: Search query string (trimmed, **minimum 2 characters**).
  - `limit`: Optional maximum results (default `15`, range `1–25`).
- **Ranking Priority:**
  1. Exact title matches first, prefix matches (`ILIKE 'q%'`) second, substring matches (`ILIKE '%q%'`) third, fuzzy trigram matches fourth.
  2. Base/root franchise entries (`isSequel = false`) prioritized above sequels/parts within each match tier.
  3. Highest trigram `SIMILARITY()` and `popularity DESC` third.
- **Response (`200 OK` — `AnimeSearchResult[]`):**
  ```json
  [
    {
      "id": 1,
      "anilistId": 10793,
      "titleEn": "Guilty Crown",
      "titleRomaji": "Guilty Crown",
      "titleJa": "ギルティクラウン",
      "titleUk": "Корона грішника",
      "titleRu": "Корона грешника",
      "synonyms": ["GC", "Корона провини"],
      "coverUrl": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx10793-f576138c.jpg",
      "type": "TV",
      "year": 2011
    }
  ]
  ```

### `AnimeService.getRandomAnime(excludeIds: string[], currentStreak: number)`

Selects a random eligible `Anime` record (requiring non-null `coverUrl` and `anilistId`) ordered by `popularity DESC`, scaling the candidate pool by the player's `currentStreak`:
- `currentStreak < 4` (Rounds 1–4): random from the **top 100** mainstream hits (`popularity > 0`, `type IN ('TV', 'MOVIE')`).
- `currentStreak < 10` (Rounds 5–10): random from the **top 400** mainstream hits (`popularity > 0`, `type IN ('TV', 'MOVIE')`).
- `currentStreak < 20` (Rounds 11–20): random from the **top 1,500** ranked titles (`popularity > 0`).
- `currentStreak >= 20`: random from the **entire catalog** (30,000+ titles).

Always excludes `excludeIds` (last `30` played anime IDs stored in Redis `game:solo:<userId>`), and gracefully falls back to localized titles (`titleUk` or `titleRu` populated) if `popularity > 0` scores have not been synced yet (`npm run catalog:sync-popularity`).

---

## 6. On-the-Fly AI Clue Generation (`AiModule` / `AiClueService`)

### `AiClueService.generateClues(anime: Anime, lang: 'uk' | 'en' | 'ru')`

Generates **6 completely distinct progressive clues on the fly** (`temperature: 0.9`) from the anime's enriched `dossier` (AniList + Wikipedia + Fandom), strictly and natively in the user's selected UI language (`uk`, `en`, or `ru`) with zero English fallback for `uk`/`ru`.

- **Strict JSON Output Schema (`GeneratedClueSet`):**
  ```json
  {
    "hard": ["Obscure Fandom trivia, background meme, world rule, or side-character quirk 1", "Hard clue 2"],
    "medium": ["Core plot premise, central conflict, or ironic problem-solving summary 3", "Medium clue 4"],
    "easy": ["Iconic plot twist, signature power/item, famous meme, or major character name/catchphrase 5", "Easy clue 6"]
  }
  ```
- **Strict Tier & No-Repeat Rules:**
  - **HARD (Clues 1 & 2):** Obscure Fandom trivia, background memes, specific world rules, or minor side-character quirks. **No main character names and no anime title.**
  - **MEDIUM (Clues 3 & 4):** Core plot premise, central conflict, or ironic summary of how the protagonist solves problems. **No main character names (refer by role/traits) and no repetition of Hard clues.**
  - **EASY (Clues 5 & 6):** Iconic plot twists, signature powers/items, famous memes, or major character names/catchphrases — without stating the anime title and without repeating or paraphrasing Clues 1–4.
  - All 6 clues must describe 6 completely distinct facts/aspects.
- **Resilience & Language-Scoped Caching:**
  1. **Primary LLM:** Groq (`llama-3.3-70b-versatile`) via `GROQ_API_KEY`.
  2. **Fallback LLM:** Google Gemini (`gemini-2.5-flash`) via `GEMINI_API_KEY` on rate-limit (`429`), language validation failure, or network error.
  3. **Language-Scoped Redis Backup Cache:** Cached under `ai_clues:<animeId>:<lang>` (30d TTL) and served if both LLM providers are unreachable, with deterministic localized dossier synthesis as final fallback.

---

## 7. Solo Game Engine (`GameModule` — Redis-Backed State)

All solo game endpoints are protected by `JwtAuthGuard` (`HttpOnly` `access_token` cookie). Active round state is stored per user in Redis under `game:solo:<userId>` with a 2-hour TTL (`7200s`), tracking:
- `targetAnimeId`: string (strictly server-side while `status === 'IN_PROGRESS'`)
- `lang`: `'uk' | 'en' | 'ru'` (synced from `POST /api/game/start` payload)
- `clues`: 6 progressive clue objects (`step: 1..6`, `difficulty: 'HARD' | 'MEDIUM' | 'EASY'`, `text: string`)
- `unlockedStep`: `1..6`
- `guesses`: `{ animeId: string, title: string, isCorrect: boolean }[]`
- `recentAnimeIds`: last `30` played anime IDs to prevent repeats
- `status`: `'IN_PROGRESS' | 'WON' | 'LOST'`

### `POST /api/game/start`

Selects a random eligible anime via `AnimeService.getRandomAnime(recentAnimeIds)` (using a language-scoped pre-warmed buffer `game:solo:next:<userId>:<lang>` when available), runs `AnimeEnrichmentService.ensureEnriched(anime.id)`, generates 6 fresh clues via `AiClueService` in the requested language, saves session state in Redis with `unlockedStep = 1`, and returns **only Clue #1** alongside `lang` and current user stats.

- **Request Body (`StartGameDto`):**
  ```json
  {
    "lang": "uk"
  }
  ```
- **Response (`200 OK` — `SoloGameResponse`):**
  ```json
  {
    "status": "IN_PROGRESS",
    "lang": "uk",
    "unlockedStep": 1,
    "maxSteps": 6,
    "unlockedClues": [
      {
        "step": 1,
        "difficulty": "HARD",
        "text": "Вигаданий гурт із цього всесвіту став реальним музичним колективом..."
      }
    ],
    "guesses": [],
    "userStats": {
      "currentStreak": 3,
      "maxStreak": 7,
      "rating": 1080
    },
    "answer": null
  }
  ```

### `POST /api/game/guess`

Submits an anime guess (`{ "animeId": "1" }`) or skips to the next clue (`{ "skip": true }`).

- **Request Body (`SubmitGuessDto`):**
  ```json
  {
    "animeId": "1",
    "skip": false
  }
  ```
- **Scoring & Streak Rules:**
  - **Correct Guess (`guessedAnime.id === targetAnime.id` OR `guessedAnime.rootAnilistId === targetAnime.anilistId` — forgiving franchise matching):**
    - Marks round `'WON'`.
    - Points by `unlockedStep`: steps `1–2` = `+30`, steps `3–4` = `+20`, steps `5–6` = `+10`.
    - Increments `currentStreak` (`+1`), updates `maxStreak` if beaten, adds `earnedPoints` to `rating` in PostgreSQL, and reveals `answer` and `allClues`.
  - **Wrong Guess or Skip (`unlockedStep < 6`):**
    - Does **not** reset `currentStreak`; increments `unlockedStep` by `1` and returns `unlockedClues` (`1..unlockedStep`) and updated `guesses`.
  - **Wrong Guess or Skip on Final Step (`unlockedStep === 6`):**
    - Marks round `'LOST'`, resets `currentStreak` to `0` in PostgreSQL, and reveals `answer` and `allClues`.

### `POST /api/game/give-up`

Immediately marks the active round as `'LOST'`, resets the user's `currentStreak` to `0` in PostgreSQL, and returns `{ status: 'LOST', userStats, answer, allClues }`.
