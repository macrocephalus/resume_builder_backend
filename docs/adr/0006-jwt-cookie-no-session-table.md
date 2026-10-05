# Sessions are a JWT in an httpOnly cookie, with no session table

Signup and login set a 7-day JWT `{ sub: userId }` in an `httpOnly`, `SameSite=Lax` cookie. The SPA
is served from the same origin as `/api`, so the cookie is first-party, there is no CORS, and
the frontend never sees the token.

## Consequences

- A token can't be revoked before it expires; logout only clears the cookie. The README lists it
  as a known simplification.
- The guard must `verify` the token, never `decode` it, and take `userId` only from it.
