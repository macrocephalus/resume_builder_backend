# 02: Accounts: signup, login, logout, me, JWT secret, guard

**Blocked by:** 01 (scaffold)

**Status:** done

**Spec:** [../spec.md](../spec.md)

**What to build:** A visitor signs up or logs in from the real frontend (no mocks) and lands on
their empty CV list; a reload keeps them signed in; restarting the api keeps them signed in;
logout signs them out. Every route except signup, login, logout and health requires the cookie.

- [x] `POST /api/auth/signup`: body validated by the shared schema (email trimmed and lower-cased, password 8–128); creates the user with an argon2id hash; `201 { user: { id, email } }` and sets the session cookie; `409 EMAIL_TAKEN` for an existing email (case-insensitive)
- [x] `POST /api/auth/login`: `200 { user }` + cookie; `401 INVALID_CREDENTIALS` with the same body and timing shape for an unknown email and a wrong password; throttled at 30 a minute per IP (`@nestjs/throttler`, in-memory) → `429 RATE_LIMITED` with `Retry-After`
- [x] `POST /api/auth/logout`: `204`, clears the cookie, works without or with an expired cookie
- [x] `GET /api/auth/me`: `200 { user }` with a valid cookie, `401 UNAUTHORIZED` otherwise
- [x] The session is a 7-day JWT `{ sub: userId }` in an httpOnly, SameSite=Lax cookie (Secure when the request came over HTTPS); the signing secret is generated on the first api start and stored in `app_secrets` with insert-on-conflict-do-nothing, then read; a `JWT_SECRET` env variable overrides it
- [x] A global guard verifies (never decodes) the token and puts the user id on the request; a `@Public()` marker opens signup, login, logout and health; a `@CurrentUser()` decorator gives handlers the id; an unknown key in any body (e.g. `userId`) is stripped by the shared schemas
- [x] e2e: the whole flow above, including the restart case (a second app instance against the same database accepts the first instance's cookie), the throttle, and that `/api/auth/me` is `401` after logout
- [ ] Manual check: the frontend on `pnpm stack` signs up, logs in, reloads, logs out without mocks
  (the same requests went through the web container's nginx with curl on 2026-10-06: signup,
  login, `me` after an api restart, logout, the throttle; a click-through in a browser is left)
