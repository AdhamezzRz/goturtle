import 'dotenv/config';
// Used by `npm run db:generate` (drizzle-kit is fetched on demand via npx, not installed).
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'mysql://goturtle:goturtle@127.0.0.1:3306/goturtle' },
  strict: true,
  verbose: true,
});
