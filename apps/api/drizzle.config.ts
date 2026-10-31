// Used by `npm run db:generate` (drizzle-kit is fetched on demand via npx, not installed),
// so this file must not import drizzle-kit itself.
import 'dotenv/config';

export default {
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'mysql://goturtle:goturtle@127.0.0.1:3306/goturtle' },
  strict: true,
  verbose: true,
};
