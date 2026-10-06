import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

/**
 * SWC compiles the Nest decorators (decoratorMetadata) the way `nest build` does. The options are
 * inline because .swcrc excludes *.test.ts from the build, which would exclude them here too.
 */
export const swcPlugin = () =>
  swc.vite({
    swcrc: false,
    jsc: {
      target: 'es2023',
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
    },
    module: { type: 'es6' },
  })

// Unit tests: pure functions and single classes, no Postgres or Redis.
export default defineConfig({
  plugins: [swcPlugin()],
  test: {
    include: ['src/**/*.test.ts'],
  },
})
