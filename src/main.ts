import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module'
import { parseEnv } from './config/env.schema'
import { runMigrations } from './database/migrate'
import { run } from './run'
import { setupApp } from './setup-app'

// The api: parse the environment, apply the migrations, listen.
run(async () => {
  const env = parseEnv(process.env)
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bufferLogs: true,
  })
  setupApp(app, env)
  const logger = app.get(Logger)
  await runMigrations(env.DATABASE_URL)
  logger.log('migrations applied', 'Bootstrap')
  await app.listen(env.PORT)
  logger.log(`api listening on port ${env.PORT}`, 'Bootstrap')
})
