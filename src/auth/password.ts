import { argon2id, hash, verify } from 'argon2'

/** argon2id with the library's defaults (64 MiB, 3 passes, 4 lanes); the PHC string keeps them. */
export const hashPassword = (password: string): Promise<string> =>
  hash(password, { type: argon2id })

export const verifyPassword = (passwordHash: string, password: string): Promise<boolean> =>
  verify(passwordHash, password)
