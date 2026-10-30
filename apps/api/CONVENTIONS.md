# GoTurtle API — engineering conventions

Read this before adding a module. The goal: every module looks like it was written by one careful engineer.

## Stack
NestJS 11 (Express) · Drizzle ORM · MySQL 8 / **MariaDB 10.6+** (production runs on Hostinger shared/cloud hosting → MariaDB, one Node process, **no inbound WebSockets, no separate workers, 120 s request timeout**) · class-validator DTOs · Jest + supertest e2e.

## Layout
```
src/
  config.ts                 typed env config (import { config })
  db/schema.ts              ALL tables (do not create tables elsewhere)
  db/client.ts              Db / Tx / DbOrTx types
  db/helpers.ts             loadByIds, groupBy, whereAll, countRows, sumOf, likeEscape, cairoToday, cairoDateTime …
  common/                   decorators (@Public, @Access, @CurrentPrincipal, @RequestMeta), principal helpers,
                            actor context, DomainError, PageQuery/paginate, crypto
  core/                     global services: AuditService, SequenceService, OtpService, JobsService,
                            StorageService, LedgerService, PostingsService, events
  modules/<name>/           <name>.module.ts, <name>.controller.ts, <name>.service.ts, dto/*.ts
test/                       e2e tests (*.e2e.spec.ts) + helpers.ts
```

## Database rules (MariaDB-safe)
- **Never use relational `with: {...}` queries** — MariaDB rejects the SQL Drizzle generates. Relations are not registered on purpose. Use `db.select({...}).from(a).leftJoin(b, eq(...))` or batch with `loadByIds()` + `groupBy()`.
- Flat `db.query.<table>.findFirst/findMany({ where, orderBy, limit })` is fine.
- No `RETURNING` in MySQL: use `.$returningId()` on insert (ids are generated client side by `newId()`), then re-select if you need the row.
- `ilike` does not exist; MySQL collation `utf8mb4_unicode_ci` is already case-insensitive → use `like(col, \`%${likeEscape(q)}%\`)`.
- JSON columns (`jsonOf<T>()`) are stored as LONGTEXT; don't query inside them with JSON functions.
- DATE columns are `'YYYY-MM-DD'` strings (Cairo business day — use `cairoToday()`); DATETIME columns are JS `Date` in UTC.
- Atomic counters: `this.sequences.code('RS', 'runsheet')` → `RS-000042`.
- Increment counters in SQL: `.set({ attempts: sql\`${orders.attempts} + 1\` })`.
- Multi-row money/state changes go in `db.transaction(async (tx) => …)`; lock rows you check-then-update with `.for('update')`.
- Update results: `const [res] = await db.update(...)` → `res.affectedRows` (cast via `as unknown as [{ affectedRows: number }]`). Use this for optimistic "claim" updates (`where status = X`).

## Money
Integers in **piasters** (`…Cents`, 1 EGP = 100). Use `@goturtle/shared` helpers (`quote`, `applyBp`, `egpToCents`). Every money movement goes through `PostingsService` / `LedgerService.post()` inside the business transaction — never update balances by hand. Postings are idempotent by `reference`.

## Auth & access
- Every route has `@Public()` or `@Access({ actors, permissions })`. No decorator = staff only.
- `actors`: `'staff' | 'brand' | 'courier' | 'customer' | 'apiKey'`. `permissions` from `@goturtle/shared` PERMISSIONS (checked for staff/brand/apiKey).
- Data scoping is the service's job: `brandScope(principal)` returns `null` for staff (all brands) or the caller's brandId; `requireCourierId(principal)` for hero endpoints. A brand must never read another brand's data — test it.
- Services take an `ActorContext` (`actorFromPrincipal(p)`, `SYSTEM_ACTOR`, `integrationActor()`), not the raw Principal.

## API shape
- Routes: `@Controller({ path: 'orders', version: '1' })` → `/api/v1/orders`. Plural nouns, actions as sub-resources: `POST /orders/:id/cancel`.
- Portal-specific route groups: `hero/...` (courier self-service), `track/...` (public/customer), `brand/...` only when the brand view differs from the staff one; otherwise share the resource route and scope by principal.
- Lists: extend `PageQuery`, return `paginate(rows, total, q)` → `{ data, meta }`.
- DTOs: class-validator + `@ApiProperty/@ApiPropertyOptional` on every field (Swagger has no CLI plugin). Use `@Type(() => Number)` for numeric query params. Validation is `whitelist + forbidNonWhitelisted`.
- Errors: `throw new DomainError('MACHINE_CODE', 'Human message', status?)`; `notFound('Order', id)`. Codes are UPPER_SNAKE and stable — the portals translate them.
- Phones: normalize with `normalizeEgyptPhone` (reject invalid with `INVALID_PHONE`), store E.164.
- Never return `passwordHash`, secrets, OTP hashes, raw API keys (except once on creation), or decrypted credentials.

## Events, jobs, realtime
- After a transaction commits, emit domain events (`DomainEvents.*` from `@goturtle/shared`, payload types in `core/events.ts`) with `EventEmitter2`. Listeners use `@OnEvent(name, { async: true })` and must never throw (catch + log).
- Background work: register in `onModuleInit` with `JobsService.register({ name, everySeconds, run })`. Jobs must finish well under 120 s (process in batches of ≤ 100).
- No WebSockets on Hostinger: portals poll (`GET …/live` endpoints that are cheap, indexed and return only what changed / what's needed).

## Audit
Call `AuditService.record(principal, { action: 'order.cancel', entity: 'Order', entityId, before, after }, meta)` for every state-changing staff/brand action (pass `tx` when inside a transaction).

## Tests
- `npm test -w @goturtle/api` (run from repo root) or `npx jest` inside apps/api. Global setup recreates `TEST_DATABASE_URL` (default `goturtle_test`) and seeds the base network; use **your own database name** when working in parallel.
- Use `createTestApp()` from `test/helpers.ts`; `t.as('brandNile').post(...)`. Seeded accounts are listed in `ACCOUNTS`.
- Cover: happy path, validation errors, permission/scoping (other brand → 404/403), state machine violations, money correctness (ledger balanced via `LedgerService.trialBalance()`).
