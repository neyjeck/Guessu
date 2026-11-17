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

> **Note:** `passwordHash` is decorated with `@Exclude()` and is never serialized in any API response.

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

## 4. Frontend Silent Refresh Flow (`frontend/src/api/client.ts`)

1. All Axios requests run with `withCredentials: true`.
2. When any protected API request returns `401 Unauthorized` (excluding `/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/logout`), the response interceptor triggers a shared `POST /api/auth/refresh` request.
3. Upon successful token rotation, the browser updates its `HttpOnly` cookies and Axios transparently retries the original request once (`_retry = true`).
4. If `POST /api/auth/refresh` fails with `401`, the user state in `AuthContext` resets to `null` (Guest mode).
