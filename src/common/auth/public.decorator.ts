import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC = Symbol('IS_PUBLIC')

/**
 * Opens a route (or a whole controller) to visitors without a session. Everything else needs the
 * session cookie: the auth guard is global, so a new route is closed until it is marked here.
 */
export const Public = () => SetMetadata(IS_PUBLIC, true)
