# Deploying GoTurtle on Hostinger (Node.js Web App)

GoTurtle ships as **one Node.js app**: the NestJS API serves the REST API under `/api` and the four portals (Ops, Brand, Hero PWA, Customer tracking) on every other path. It is built for Hostinger's Node.js hosting limits: MySQL/MariaDB only, one process, no inbound WebSockets (portals poll), no background workers (jobs run in-process and through a cron URL), 120 s request timeout.

> Requires a Hostinger **Business** or **Cloud** plan (Node.js apps are not available on lower plans).

## 1. Create the database
hPanel → **Databases → MySQL Databases** → create a database + user (note the name, user, password; host must be `127.0.0.1` (not `localhost` — Node resolves it to IPv6 `::1`, which Hostinger MySQL rejects; GoTurtle converts it automatically)).

The connection string has this shape (URL-encode special characters in the password):
```
mysql://u123456_goturtle:YOUR_PASSWORD@127.0.0.1:3306/u123456_goturtle
```

## 2. Create the Node.js app
hPanel → **Websites → Add website → Node.js Web App** → **Import Git repository** (connect GitHub, choose this repo and branch).

| Setting | Value |
|---|---|
| Framework preset | Other / Express |
| Node version | 22.x (20.11+ works) |
| Root directory | `/` (repo root) |
| Install command | `npm ci` (or `npm install`) |
| Build command | `npm run build` |
| Entry file | `server.js` |

Pushing to the branch redeploys automatically.

## 3. Environment variables
hPanel → your app → **Environment variables** (you can import `apps/api/.env.example` and edit). Minimum:

| Variable | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `APP_URL` | `https://goturtle.example.com` | used in SMS tracking links & webhooks |
| `DATABASE_URL` | `mysql://user:pass@127.0.0.1:3306/db` | |
| `JWT_ACCESS_SECRET` | 48+ random chars | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `JWT_REFRESH_SECRET` | 48+ random chars | different from the access secret |
| `ENCRYPTION_KEY` | 32+ random chars | encrypts integration credentials — never change after go-live |
| `CRON_SECRET` | random string | protects the cron URL |
| `BOOTSTRAP_ADMIN_PHONE` | `01000000000` | first super admin (created on first boot) |
| `BOOTSTRAP_ADMIN_PASSWORD` | strong password | change it after first login |
| `UPLOAD_DIR` | `/home/u123456/goturtle-uploads` | **outside** the app folder so redeploys keep POD photos & documents |
| `DB_POOL_SIZE` | `5` | keep small on shared plans |

Optional (each feature works without them and switches on when set — details in `apps/api/.env.example` and [ROADMAP.md](ROADMAP.md)):

| Variable(s) | Turns on |
|---|---|
| `SMS_PROVIDER`, `WHATSAPP_PROVIDER` + provider keys | real SMS / WhatsApp messages (default `console` only logs them) |
| `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | customer WhatsApp replies — webhook `https://your-domain/api/v1/integrations/inbound/whatsapp` |
| `SMS_INBOUND_SECRET` | customer SMS replies — `https://your-domain/api/v1/integrations/inbound/sms?key=…` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PROXY_SERVICE_SID` | masked hero ↔ customer calls with automatic call logs |
| `PAYMENT_PROVIDER=paymob`, `PAYMOB_*` | online payment links (before delivery and at the door) |
| `GEOCODER=google\|mapbox`, `GOOGLE_MAPS_API_KEY` / `MAPBOX_TOKEN` | address geocoding |
| `ROUTING_PROVIDER=osrm\|google`, `OSRM_URL` | traffic-aware route optimisation (default: distance estimate) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | push notifications — generate once with `node -e "console.log(require('web-push').generateVAPIDKeys())"` |

Business rules for these features (confirmation thresholds, geofence, fees, claim caps, weight tolerance, forecast events…) are edited in **Ops → Settings** (Integrity, Finance, Platform tabs) — no redeploy needed.

Migrations run automatically on boot (`DB_AUTO_MIGRATE=true`). The first boot creates the chart of accounts and the bootstrap super admin.

## 4. Background jobs (cron)
Hostinger does not keep background workers alive, so GoTurtle also runs its jobs (webhook retries, SMS queue, delivery confirmations & holds, location requests, shift attendance, SLA checks, settlements) when its cron URL is called.

hPanel → **Advanced → Cron Jobs** → every minute (`* * * * *`):
```
curl -fsS -X POST "https://goturtle.example.com/api/v1/system/cron?key=YOUR_CRON_SECRET" > /dev/null
```
(Alternatively use an external service such as cron-job.org with the same URL.)

## 5. Load the Cairo network (first time only, no SSH needed)
Sign in as the super admin → **Ops → System → First-run setup**:
- **Load Greater Cairo network** — 25 zones, 4 hubs, Standard & Growth rate cards. Production-safe and idempotent.
- **Load demo data** (optional, only on an empty system) — demo staff, 3 brands, 10 heroes and ~3 weeks of orders, all with password `Turtle@2026`. Great for exploring; delete/suspend those accounts before going live.

Then create your real brands (Ops → Brands → Onboard) and heroes (Ops → Heroes → Onboard).

## 6. Verify
- `https://your-domain/api/v1/system/health` → `{"status":"ok","database":"ok"}`
- `https://your-domain/api/docs` → interactive API documentation (Swagger)
- `https://your-domain/login` → sign in with the bootstrap admin
- Heroes install the app from `https://your-domain/hero` (Add to Home Screen)

## Troubleshooting
GoTurtle never crash-loops on a bad setup. If startup fails, the site shows a **"GoTurtle · <REASON>"** page and `/api/v1/system/health` returns `{"status":"error","error":"<REASON>",...}` that names the problem (no secrets are shown). The full error is in hPanel → your app → **Runtime logs**.

| Reason on the page | Fix |
|---|---|
| `CONFIG_INVALID` | the page lists each missing/invalid environment variable — add them, then **redeploy** (a restart does not reload env vars) |
| `DB_ACCESS_DENIED` | wrong DB user/password in `DATABASE_URL`, or the user is not assigned to the database |
| `DB_UNKNOWN_DATABASE` | database name in `DATABASE_URL` is wrong — copy it exactly from hPanel → Databases |
| `DB_UNREACHABLE` | wrong host/port — use host `127.0.0.1` and port `3306` |
| `NODE_VERSION` | select Node.js 20 or 22 for the app |
| `BUILD_MISSING` | build command must be `npm run build`, root directory the repo root — check the build log |

| Plain **503** with no GoTurtle page | the process is not running at all: check the build log, that the entry file is `server.js`, then Restart / Redeploy. Hostinger also returns 503 when the plan hits its process or memory limit — stop unused Node apps (each domain and `www` subdomain runs its own process) |
| App crashes at start with "Invalid configuration" | a required env var is missing/too short — the page and log list which |
| `ER_ACCESS_DENIED_ERROR` | wrong DB user/password or the user isn't assigned to the database |
| Build fails with `tsc: not found` | make sure the install step runs at the repo root (workspaces) |
| Live map not updating | it polls every 10 s; check the browser can reach `/api/v1/dispatch/live` |
| Uploaded photos disappear after redeploy | set `UPLOAD_DIR` outside the app directory |
| Jobs not running | check the cron job and `GET /api/v1/system/jobs` (super admin) |
