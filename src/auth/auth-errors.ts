import { AppError } from '../common/errors/app-error'

/** No session, or one whose token or account no longer holds. */
export const notSignedIn = () => new AppError(401, 'UNAUTHORIZED', 'Please log in.')

/** The same for an unknown email and a wrong password, so emails can't be probed. */
export const invalidCredentials = () =>
  new AppError(401, 'INVALID_CREDENTIALS', 'Wrong email or password.')
