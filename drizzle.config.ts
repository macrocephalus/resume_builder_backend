import { defineConfig } from 'drizzle-kit'

// `pnpm db:generate` writes a SQL migration into drizzle/ from the schema; the api applies the
// committed migrations on start (src/database/migrate.ts). drizzle-kit never touches a database here.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
})
