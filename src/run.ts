import { EnvError } from './config/env.schema'

/**
 * Runs an entry point. A bad environment prints only its message (the variables), anything else
 * the full error; both end the process with exit code 1 so compose restarts it.
 */
export const run = (bootstrap: () => Promise<void>): void => {
  bootstrap().catch((error: unknown) => {
    console.error(error instanceof EnvError ? error.message : error)
    process.exit(1)
  })
}
