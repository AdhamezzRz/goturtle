# GoTurtle Web — engineering conventions

One Vite + React 19 SPA, four code-split portals, served in production by the API (same origin, `/api/v1`).

| Portal | Route | Users | Shell |
|---|---|---|---|
| Ops (company) | `/ops/*` | staff roles | `AppShell` (sidebar) |
| Brand | `/brand/*` | BRAND_OWNER / BRAND_STAFF | `AppShell` |
| Hero | `/hero/*` | COURIER (mobile PWA) | `HeroShell` (bottom tabs) |
| Customer | `/track`, `/t/:trackingNumber` | public + OTP session | own minimal layout |

## Rules
- **Data**: TanStack Query only. `api<T>(path, { method, body, query, auth })` from `@/lib/api` (auto refresh, `ApiError {status, code, message}`); customer endpoints use `auth: 'customer'` (token from `sessionStore.customer()`). Lists are `Paginated<T>` → `{ data, meta }`. Query keys: `['orders', filters]` etc.; invalidate after mutations.
- **Errors/toasts**: `toast.error(errorMessage(err))` (translates `error.<CODE>`), `toast.success(...)` from `sonner`.
- **No WebSockets** (Hostinger): poll with `refetchInterval: usePollInterval(10_000)` (pauses on hidden tabs).
- **i18n**: every visible string goes through `t('key')`. Each portal registers its strings once with `registerDictionary({...})` in its own `portals/<portal>/i18n.ts` (flat keys prefixed by portal: `ops.orders.title`). Arabic is default and RTL — use logical Tailwind classes only (`ms-/me-/ps-/pe-/start-/end-/text-start/text-end`, never `ml/mr/pl/pr/left/right`). Wrap phone numbers, tracking numbers, codes and money in `className="ltr"` when inside Arabic text. Bilingual DB fields: `pick(row, 'name')` → nameAr/nameEn.
- **Formatting**: `money(cents)`, `num()`, `pct()`, `dateTime()`, `dateOnly()`, `timeOnly()`, `ago()`, `phone()`, `statusLabel()` from `@/lib/format`. Money from the API is always piasters (`…Cents`); convert user input with `parseEgp()`.
- **Domain logic**: reuse `@goturtle/shared` (enums, `ORDER_STATUS_TONE`, `canTransition`, `quote`, `levelForXp`, `hasPermission`, `normalizeEgyptPhone`, `isValidTrackingNumber`…). Don't duplicate rules.
- **Permissions**: `useAuth().can('orders.create')`, `<Can permission="…">`; nav items take `permission`.
- **UI kit** (`@/components/ui`): Button/IconButton, Field/Input/Textarea/Select/Checkbox/Switch, Card/CardHeader/KpiCard/Badge/StatusBadge/StateBadge/RiskBadge/DescriptionList/Avatar/ProgressBar, PageHeader, DataTable (+selection)/Pagination/Tabs, Modal/Drawer/ConfirmDialog/Menu, Timeline, Barcode/QrCode, Skeleton/Spinner/PageLoader/EmptyState/ErrorState. Map: `import { LiveMap } from '@/components/ui/Map'` (Leaflet; lazy-load the page that uses it). Charts: `recharts`.
- **URL state**: list filters live in the URL via `useQueryState()` so views are shareable.
- **Design**: brand green `turtle-*`, cash/COD accent `sand-*`, neutrals `ink-*`; rounded-2xl cards, generous spacing, display font `font-display` for headings/numbers; dark mode via `dark:` classes. Every list has loading skeletons, empty and error states. Mobile-first for Hero and Customer; Ops/Brand must still work on a phone.
- **Accessibility**: labels on inputs (`Field`), `aria-label` on icon buttons, focus states preserved, 44px touch targets in the Hero app.
- **Printing**: AWB labels (4×6 in) and manifests use `.label-sheet`, `.no-print`, `.print-only` + `window.print()`.
- **Type safety**: `npx tsc -p apps/web/tsconfig.json` must be clean (noUnusedLocals is on). Describe API response types next to the page that uses them (or `portals/<portal>/types.ts`).

## Dev
`npm run dev` at repo root → API :4000 + Vite :5173 (proxy `/api`). Seeded logins are listed on the login page in dev (`?demo` in prod).
