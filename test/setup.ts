import { getTableName, is } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import { Pool } from 'pg'
import { afterAll, beforeEach } from 'vitest'
import * as schema from '../src/database/schema'
import { testDatabaseUrl } from './helpers/env'

// Runs in every e2e test file: every test starts from empty tables (the migrations stay).
const pool = new Pool({ connectionString: testDatabaseUrl(), max: 1 })
const tables = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => `"${getTableName(table)}"`)
  .join(', ')

beforeEach(async () => {
  await pool.query(`truncate ${tables} cascade`)
})

afterAll(async () => {
  await pool.end()
})
