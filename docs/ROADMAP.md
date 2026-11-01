# GoTurtle — roadmap & items waiting on external accounts

Everything below is **already designed into the code** (adapters, settings, env vars, UI hooks) and only waits for an account, credentials or a business decision. Switching each on is configuration, not a rebuild.

## Needs provider accounts / credentials
| Item | What to get | Where it plugs in |
|---|---|---|
| WhatsApp messages & replies (confirmations, attempt verification, location requests) | Meta WhatsApp Cloud API: phone number ID, permanent token, app secret, verify token, approved templates | `WHATSAPP_PROVIDER=whatsapp_cloud`, `WHATSAPP_CLOUD_*`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`; webhook `/api/v1/integrations/inbound/whatsapp` |
| SMS (OTP, fallback messages) | SMS Misr / Victory Link / Twilio account + sender ID approved by NTRA | `SMS_PROVIDER` + provider env vars |
| Masked calling (hero ↔ customer through a proxy number, call logs from the network) | Twilio Proxy (or an Egyptian VoIP provider with an API) | `TWILIO_*` env vars, call status webhook |
| Online payments & payment links at the door | Paymob merchant account (API key, HMAC secret, integration IDs) | `PAYMENT_PROVIDER=paymob`, `PAYMOB_*` |
| Instant brand payouts by API | InstaPay / bank disbursement API (e.g. bank corporate API, Paymob payouts) | payout adapter in money programs (manual today: finance marks paid with reference) |
| Geocoding & traffic-aware routing | Google Maps Platform key (Geocoding + Routes) or Mapbox token; or self-hosted OSRM | `GEOCODER`, `GOOGLE_MAPS_API_KEY`/`MAPBOX_TOKEN`, `OSRM_URL` |
| Premium map tiles (optional) | MapTiler / Mapbox / Stadia key | `VITE_MAP_TILE_URL` (build time) + `MAP_TILE_HOSTS` |
| Push notifications | Generate VAPID keys (free, one command) | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| E-commerce connectors (Zid, Salla, YouCan, EasyOrders) | A test merchant account on each platform to verify signatures & payloads live | Brand portal → API & integrations |
| Partner carriers by API (Bosta, Aramex, Egypt Post, J&T…) | Partner contracts + API credentials | partner adapter interface (manual handoff works today) |

## Needs a decision or physical setup
| Item | Notes |
|---|---|
| Egyptian Tax Authority e-invoicing (ETA) | Requires ETA portal registration and a signing certificate/USB token (or a signing service). `settlements.etaInvoiceUuid` is reserved; invoices are generated today. |
| Native Android/iOS hero app (background GPS on iPhone, store listing) | Wrap the existing PWA with Capacitor; needs Apple/Google developer accounts. The PWA works today (foreground GPS). |
| Hub scales & label printers | Any USB/Bluetooth scale that types into a field works with the Weigh mode; 4×6 thermal printers work with the label print view. |
| Insurance & claim liability policy | Set caps and windows in Ops → Settings → Finance. |

## Next product ideas
- Customer WhatsApp chatbot for "where is my order" and support.
- Dynamic pricing by zone demand and time slots.
- Brand-facing NPS / delivery experience scores.
- Multi-city expansion (Alexandria, Delta) with hub-to-hub line hauls.

## Engineering follow-ups (no external dependency)
- Partner carriers: move per-partner fees out of the encrypted credentials into `carrier_partners.feeCents/returnFeeCents` and link the virtual hero by a `courierId` column; index `orders.orderLinkId`.
- Claims: optional per-plan liability cap (today: declared value, else the Finance default cap).
- Weight re-pricing: when the recipient pays the fees, raise the amount to collect instead of charging the brand wallet.
- Forecast: widen the 80 % interval when demand is trending (point forecast MAPE ≈ 7 % on synthetic history; interval coverage too narrow).
- Web Push: re-register a rotated subscription from the service worker itself (today it re-registers the next time the profile/Me page opens).
- Partner carriers by API: the adapter interface and a 15-minute polling job exist; only the manual adapter is implemented.
