import { type DynamicModule, Module } from '@nestjs/common'
import type { Env } from './env.schema'

/** Injection token for the parsed environment (`Env`). */
export const ENV = Symbol('ENV')

/**
 * Carries the environment parsed in the entry point (`main.ts`, `worker.ts`) into the Nest tree.
 * Tests pass their own `Env`, so nothing reads `process.env` after start.
 */
@Module({})
export class ConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: ConfigModule,
      global: true,
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    }
  }
}
