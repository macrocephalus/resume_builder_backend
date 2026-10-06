import { defineConfig } from 'vitest/config'
import { swcPlugin } from './vitest.config.mjs'

// e2e: the api (and later the worker) in the test process, driven over HTTP with supertest,
// against the Postgres and Redis from compose.yaml (`cv_test` database, own BullMQ prefix).
// One database for every file, so files run one after another.
export default defineConfig({
  plugins: [swcPlugin()],
  test: {
    include: ['test/**/*.e2e.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
