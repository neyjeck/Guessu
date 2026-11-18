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

## 5. Multilingual Anime Search & Random Selection (`AnimeModule`)

### `GET /api/anime/search?q=<query>&limit=10`

Performs fast case-insensitive substring (`ILIKE '%q%'`) + PostgreSQL `pg_trgm` trigram similarity (`SIMILARITY` & `WORD_SIMILARITY`) matching across `titleEn`, `titleRomaji`, `titleUk`, `titleRu`, `titleJa`, and `synonyms`.

- **Query Parameters (`SearchAnimeDto`):**
  - `q`: Search query string (trimmed, **minimum 2 characters**).
  - `limit`: Optional maximum results (default `10`, range `1–20`).
- **Ranking Priority:**
  1. Direct prefix matches (`ILIKE 'q%'`) on any localized title (`+2.0` score boost) — e.g. typing `"guil"` immediately ranks `"Guilty Crown"` at `#1`.
  2. Direct substring matches (`ILIKE '%q%'`) on any localized title or `synonyms` (`+1.0` score boost).
  3. Highest `SIMILARITY()` / `WORD_SIMILARITY()` across `titleRomaji`, `titleEn`, `titleUk`, `titleRu`, and `synonyms`.
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
      "coverUrl": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx10793-f576138c.jpg"
    }
  ]
  ```

### `AnimeService.getRandomAnime(excludeIds: string[])`

Selects a completely random `Anime` record from PostgreSQL excluding only the recently played IDs passed in `excludeIds` (no rigid popularity tier restrictions). Falls back to the full catalog if all existing anime IDs are in `excludeIds`.

---

## 6. On-the-Fly AI Clue Generation (`AiModule` / `AiClueService`)

### `AiClueService.generateClues(anime: Anime, lang: 'uk' | 'en' | 'ru')`

Generates **6 fresh progressive clues on the fly** (`temperature: 0.9`) from the anime's 3-source `dossier` (AniList synopsis/characters/tags + Wikipedia plot summary + Fandom Wiki trivia/memes), written natively in the user's selected UI language (`uk`, `en`, or `ru`).

- **Strict JSON Output Schema (`GeneratedClueSet`):**
  ```json
  {
    "hard": ["Deep lore, Fandom trivia/meme, or worldbuilding mechanic clue 1", "Hard clue 2"],
    "medium": ["Faction, secondary character, or signature power clue 3", "Medium clue 4"],
    "easy": ["Main character names, catchphrases, or iconic plot hook clue 5", "Easy clue 6"]
  }
  ```
- **Prompt Rules:**
  - Character names, factions, world terms, specific abilities, and Fandom memes/trivia **ARE ALLOWED and encouraged**.
  - Only the exact title of the anime itself (across all languages/synonyms) is strictly forbidden and scrubbed (`[***]`).
- **Resilience & Multi-Tier Fallback:**
  1. **Primary LLM:** Groq (`llama-3.3-70b-versatile`) via `GROQ_API_KEY`.
  2. **Fallback LLM:** Google Gemini (`gemini-2.5-flash`) via `GEMINI_API_KEY` on rate-limit (`429`) or network errors.
  3. **Emergency Redis Cache:** Last valid generated clue set per `(animeId, lang)` is cached in Redis (`ai_clues:backup:<animeId>:<lang>`, 30d TTL) and served if both LLM providers are unreachable, with deterministic dossier synthesis as final fallback.
