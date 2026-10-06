import type { CookieOptions, Request, Response } from 'express'
import { SESSION } from '../config/limits'

/** The cookie that carries the session JWT. The page script never sees it (`httpOnly`). */
export const SESSION_COOKIE = 'cv_session'

/** `Secure` when the request came over HTTPS, directly or through the trusted proxy. */
const options = (req: Request): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: req.secure,
  path: '/',
})

export const setSessionCookie = (req: Request, res: Response, token: string): void => {
  res.cookie(SESSION_COOKIE, token, { ...options(req), maxAge: SESSION.ttlSeconds * 1000 })
}

export const clearSessionCookie = (req: Request, res: Response): void => {
  res.clearCookie(SESSION_COOKIE, options(req))
}
