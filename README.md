# 🐢 GoTurtle — Last-mile Logistics ERP for Egypt

GoTurtle runs a delivery company end to end. Heroes (couriers) pick parcels up from brands, deliver them across Greater Cairo, and collect cash on delivery. Every piaster is then reconciled back to the company and settled to the brand.

**Four portals, one platform:**

| Portal | Who | Highlights |
|---|---|---|
| **Ops** `/ops` | GoTurtle staff (admin, ops, dispatch, hub, finance, support) | live control tower, smart auto-dispatch & route optimisation, hub scanning, heroes & shifts, COD cash custody, settlements & payroll, double-entry ledger, analytics, tickets |
| **Brand** `/brand` | merchants | create/bulk-upload orders with instant quotes, pickups, AWB labels, COD wallet & settlements, API keys, webhooks, Shopify/WooCommerce |
| **Hero** `/hero` | delivery heroes (installable PWA) | today's route, call/WhatsApp/navigate, OTP + photo proof of delivery, cash wallet & handovers, shifts clock-in/out, earnings, levels & badges |
| **Customer** `/t/<tracking>` | recipients | live tracking, hero on the map, reschedule, address pin, rating, support |

**Built to kill the daily problems of Egyptian last-mile (v1.1):**

| Daily problem | What GoTurtle does |
|---|---|
| Customers refuse COD parcels (RTO) | WhatsApp/SMS confirmation before dispatch (reply 1/2/3, Arabic & Franco understood), unconfirmed high-risk parcels held, prepay-only rule for repeat refusers, cross-brand risk & blocklist |
| Fake "customer not answering" attempts | failed attempts need GPS within 300 m of the pin and logged, spaced calls; the customer is asked to confirm and can dispute → ticket + hero penalty through the ledger |
| Bad addresses | address book reuses a customer's verified pin across brands, automatic "share your location" requests, Google/Mapbox geocoding (approximate only) |
| Cash risk & slow brand payouts | InstaPay / wallet / card / payment-link at the door (hero carries no cash), finance confirmation queue, early payouts & COD advances recovered exactly at settlement |
| Lost / damaged parcels and weight fights | claims with liability caps and payouts, hub weighing with volumetric re-pricing and brand disputes |
| Social sellers without a store | shareable order links (`/o/<code>`) — the buyer fills in the address and gets an instant quote |
| Orders stuck in other platforms | EasyOrders, Zid, Salla, YouCan (plus Shopify, WooCommerce, API) connectors |
| Destinations outside our zones | partner carriers as virtual heroes: handoff, outcomes, custody & remittances |
| Too many or too few heroes | demand forecast per hub & shift with recommended staffing |
| Missed updates | Web Push to heroes, brands and ops; traffic-aware routing via OSRM/Google |

What still needs your accounts (WhatsApp Business, SMS sender, Paymob, …) is listed in [docs/ROADMAP.md](docs/ROADMAP.md).

Built for production on **Hostinger Node.js hosting** (MySQL, one process, no WebSockets) — see [docs/DEPLOY_HOSTINGER.md](docs/DEPLOY_HOSTINGER.md).

## Quick start (local)
Requirements: Node 20.11+ and MySQL 8 or MariaDB 10.6+.
```bash
npm install
cp apps/api/.env.example apps/api/.env      # set DATABASE_URL (and dev secrets)
npm run build                                # shared + web + api
npm run db:seed                              # Cairo network, demo brands, heroes, orders and v1.1 demo data
npm run dev                                  # API :4000 + web :5173
```
Open http://localhost:5173. Demo accounts (password `Turtle@2026` unless noted):

| Role | Phone |
|---|---|
| Super admin | `01000000000` / `Admin@12345` (from `BOOTSTRAP_ADMIN_*`) |
| Ops manager · Dispatcher · Hub · Finance · Support | `01000000001` … `01000000005` |
| Brand owners (Nile Threads, Cairo Gadgets, Bloom Beauty) | `01110000011` · `01110000012` · `01110000013` |
| Heroes HR-00001 … HR-00010 | `01200000001` … `01200000010` |

API docs: http://localhost:4000/api/docs

## Repository
```
packages/shared   domain logic shared by API & web (state machine, pricing, routing, risk, phones, addresses)
apps/api          NestJS + Drizzle (MySQL/MariaDB) — REST API, jobs, ledger; serves the web build
apps/web          React SPA — Ops, Brand, Hero (PWA) & Customer portals
docs/             architecture, deployment, integrations
```
More: [Architecture](docs/ARCHITECTURE.md) · [API conventions](apps/api/CONVENTIONS.md) · [Web conventions](apps/web/CONVENTIONS.md)

## Quality gates
```bash
npm run typecheck   # strict TypeScript across all workspaces
npm test            # unit tests + e2e tests against a real MySQL/MariaDB
npm run build       # production build
```
CI runs all three on MariaDB 10.11 (`.github/workflows/ci.yml`).
