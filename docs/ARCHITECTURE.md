# GoTurtle — architecture

```
                ┌──────────────────────────── one Node.js process (Hostinger) ───────────────────────────┐
 Browser  ───►  │  NestJS (Express)                                                                       │
  /ops/*        │   ├─ /api/v1/*  REST API ── AuthGuard (JWT · API key · customer OTP) ── RBAC permissions │
  /brand/*      │   │     modules: orders · workflow · pickups · dispatch · hero-tasks · tracking ·        │
  /hero/* (PWA) │   │              couriers · hero · shifts · cash · finance · gamification ·              │
  /t/:tracking  │   │              brands · users · api-keys · webhooks · notifications · integrations ·    │
                │   │              tickets · analytics · settings · payments · network · pricing           │
                │   ├─ core: Ledger (double-entry) · Postings · Jobs · OTP · Sequences · Audit · Storage   │
                │   ├─ /api/docs  OpenAPI / Swagger                                                        │
                │   └─ static SPA (apps/web/dist) with index.html fallback                                 │
                └───────────────┬───────────────────────────────┬───────────────────────────────────────┘
                                │ mysql2 pool (Drizzle ORM)      │ fetch
                         MySQL / MariaDB                 SMS · WhatsApp · email · Paymob · Shopify/Woo · webhooks
         cron (hPanel, every minute) ──► POST /api/v1/system/cron?key=… ──► JobsService.tick()
```

## Packages
- `packages/shared` — pure TypeScript domain logic used by API **and** web: enums, the order state machine, pricing engine, Egyptian phone & address parsing (Arabic/English/Franco), route optimisation (nearest-neighbour + 2-opt), COD risk scoring, permissions, gamification, webhook event names.
- `apps/api` — NestJS 11 + Drizzle ORM (MySQL/MariaDB). See `apps/api/CONVENTIONS.md`.
- `apps/web` — Vite + React 19 + Tailwind SPA with four code-split portals. See `apps/web/CONVENTIONS.md`.

## Key design decisions
| Decision | Why |
|---|---|
| Single process serving API + SPA | Hostinger Node.js apps run one process per site; same origin = no CORS, simple cookies/CSP |
| MySQL/MariaDB via Drizzle, no relational `with` queries | Hostinger only offers MySQL (MariaDB); Drizzle's relational SQL uses LATERAL/derived-table correlation MariaDB rejects — joins and batch loaders instead |
| Pure-JS stack (no native engines) | Shared hosting process/thread limits; nothing to compile at install |
| Money as integer piasters + double-entry ledger | Exact arithmetic; every COD pound is traceable from customer → hero custody → treasury → brand payout |
| Order state machine in `shared` | Same rules enforced by the API and shown by the portals |
| Domain events after commit + DB-backed queues (webhooks, notifications) | Reliable delivery with retries without Redis/workers |
| Jobs in-process + cron URL + DB job locks | Works with or without a long-lived process; never double-runs |
| Polling instead of WebSockets | Hostinger blocks inbound WebSockets; `…/live` endpoints are cheap and indexed |
| Refresh-token rotation with reuse detection | Stolen refresh tokens kill the whole session family |
| Customer access by SMS OTP scoped to a phone/shipment | No customer passwords; public tracking never leaks PII |

## Money flow (COD)
```
Customer pays hero 1,000   Dr 1100 Hero custody        / Cr 2100 Brand wallet
Fees 57 (incl. VAT)        Dr 2100 Brand wallet        / Cr 4000 Shipping · 4010 COD fee · 2300 VAT
Hero earns 22              Dr 5000 Hero pay            / Cr 2200 Hero payable
Hero hands over cash       Dr 1000 Treasury / 1010 Bank / Cr 1100 Hero custody
Brand settlement paid      Dr 2100 Brand wallet        / Cr 1010 Bank
Hero payout                Dr 2200 Hero payable        / Cr 1010 Bank
```
The trial balance (`GET /api/v1/finance/trial-balance`) must always balance; tests assert it.
