# GoTurtle brand identity

Source: **go turtle Logo.pdf** (logo & colour palette). Everything in the product is built from it:
the wordmark paths, the arch, and the five colours below. Nothing is redrawn by hand.

## Logo
The wordmark **go turtle** is seven vector shapes. Its signature is the **arch**, *turtle + delivery*:
a shell that also reads as the route a parcel travels from pickup to door.

| File (served from `/identity/`) | Use on |
|---|---|
| `wordmark-ink.svg` / `.png` | white, cream, light photos |
| `wordmark-lime.svg` / `.png` | turtle green (primary brand surface) |
| `wordmark-green.svg` / `.png` | lime |
| `wordmark-white.svg` / `.png` | ink, dark photos |
| `wordmark-black.svg` | 1-colour print, thermal labels |
| `mark.svg`, `mark-lime.svg` | app icon (arch on a rounded tile) |

App icons: `/favicon.svg`, `/favicon-32.png`, `/apple-touch-icon.png`, `/icon-192.png`, `/icon-512.png`,
`/icon-maskable-512.png`. Social preview: `/og-image.png` (1200 × 630). In the app, Ops → Settings →
Branding has a **Brand kit** panel to download every file and copy colours.

Rules: never re-type, stretch or recolour the wordmark outside the palette. Keep clear space of at least the
arch's height. Smallest size: 24 px tall on screen, 8 mm in print.

## Colours
| Token | Hex | Role |
|---|---|---|
| `turtle-600` | `#00804C` | primary — buttons, links, Ops sidebar, hero app header |
| `leaf-400` | `#74C465` | secondary green — "done", charts |
| `lime-300` | `#DBE64C` | highlight on green/ink: active nav, chips, the parcel. Never text on white |
| `cream` | `#F6F8EC` | public pages canvas (landing, tracking, order links), email |
| `ink-950` | `#080C19` | text, Brand-portal sidebar, dark mode canvas |

Full 50–950 scales live in `apps/web/tailwind.config.js` (`turtle`, `leaf`, `lime`, `cream`, `ink`).
Primary buttons (white on `#00804C`) meet WCAG AA (5.0 : 1).

## Typography
- **Readex Pro** for display: geometric with rounded terminals like the wordmark, and it covers Arabic and Latin.
- **Inter** and **Cairo** for UI text.
- The brand book's Neue Haas Grotesk is licensed, so Inter is its free stand-in.

## Motif in the product
- **Arch loader:** the arch draws itself, used for page loading.
- **Arch journey:** on customer tracking and the landing page the parcel travels along the arch. It runs right to left in Arabic.
- **Watermarks:** faint arches on the sidebars, the hero header and the landing sections.

## Code
- `apps/web/src/components/brand/geometry.ts`: logo paths, arch geometry, palette (single source).
- `apps/web/src/components/brand/index.tsx`: `Wordmark`, `ArchMark`, `ArchTile`, `ArchLoader`, `ArchProgress`.
- `scripts/brand/generate-assets.cjs`: regenerates every icon and image from the geometry (needs Playwright).
