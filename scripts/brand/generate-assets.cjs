// Regenerates the GoTurtle brand kit (apps/web/public: favicon, app icons, og-image, identity/*) from
// apps/web/src/components/brand/geometry.ts — the paths extracted from the official logo PDF.
// Usage (needs Playwright + Chromium, not a project dependency):
//   node scripts/brand/generate-assets.cjs apps/web/src/components/brand/geometry.ts apps/web/public
const fs = require('fs'); const path = require('path');
const { chromium } = require('playwright');
const geo = fs.readFileSync(process.argv[2], 'utf8');
const OUT = process.argv[3];
const PATHS = JSON.parse(geo.match(/WORDMARK_PATHS: readonly string\[\] = (\[[\s\S]*?\]);/)[1]);
const VB = geo.match(/WORDMARK_VIEWBOX = '([^']+)'/)[1];
const ARCH = geo.match(/ARCH_PATH =\n  '([^']+)'/)[1];
const C = { green: '#00804C', leaf: '#74C465', lime: '#DBE64C', cream: '#F6F8EC', ink: '#080C19', white: '#FFFFFF', black: '#000000' };
const [, , W, H] = VB.split(' ').map(Number);
const wordmark = (fill, title = 'go turtle') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB}" width="${W}" height="${H}" role="img" aria-label="${title}"><title>${title}</title><g fill="${fill}">${PATHS.map((d) => `<path d="${d}"/>`).join('')}</g></svg>\n`;
// App icon: arch centred on a rounded square. scale = arch width share of the tile.
const icon = ({ bg, fg, size = 512, scale = 0.56, radius = 0.225, dy = 0 }) => {
  const s = (size * scale) / 200; const off = (size - 200 * s) / 2;
  const r = radius * size;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${bg ? `<rect width="${size}" height="${size}" rx="${r}" fill="${bg}"/>` : ''}<path transform="translate(${off} ${off + dy * size}) scale(${s})" fill="${fg}" d="${ARCH}"/></svg>\n`;
};
fs.mkdirSync(path.join(OUT, 'identity'), { recursive: true });
const files = {
  'identity/wordmark-ink.svg': wordmark(C.ink),
  'identity/wordmark-white.svg': wordmark(C.white),
  'identity/wordmark-green.svg': wordmark(C.green),
  'identity/wordmark-lime.svg': wordmark(C.lime),
  'identity/wordmark-black.svg': wordmark(C.black),
  'identity/mark.svg': icon({ bg: C.green, fg: C.lime }),
  'identity/mark-lime.svg': icon({ bg: C.lime, fg: C.green }),
  'identity/arch-green.svg': icon({ bg: null, fg: C.green, size: 200, scale: 1 }),
  'favicon.svg': icon({ bg: C.green, fg: C.lime, size: 64, scale: 0.66, radius: 0.24 }),
};
for (const [f, s] of Object.entries(files)) fs.writeFileSync(path.join(OUT, f), s);
const og = `<html><head><link href="https://fonts.googleapis.com/css2?family=Readex+Pro:wght@500;700&display=block" rel="stylesheet"></head><body style="margin:0">
<div style="width:1200px;height:630px;background:${C.green};position:relative;overflow:hidden;font-family:'Readex Pro',sans-serif">
  <svg style="position:absolute;right:-120px;bottom:-210px;opacity:.16" width="720" height="720" viewBox="0 0 200 200"><path fill="${C.lime}" d="${ARCH}"/></svg>
  <div style="position:absolute;left:84px;top:150px;width:640px">${wordmark(C.lime).replace(/width="[^"]+" height="[^"]+"/, 'width="640" height="208"')}</div>
  <div style="position:absolute;left:90px;top:410px;color:${C.cream};font-size:40px;font-weight:500;letter-spacing:-.5px">Last-mile delivery across Cairo</div>
  <div style="position:absolute;left:90px;top:468px;color:${C.lime};font-size:30px;font-weight:500;direction:rtl">توصيل لحد الباب في القاهرة الكبرى</div>
  <div style="position:absolute;left:0;right:0;bottom:0;height:18px;display:flex"><div style="flex:1;background:${C.lime}"></div><div style="flex:1;background:${C.leaf}"></div><div style="flex:1;background:${C.cream}"></div><div style="flex:1;background:${C.ink}"></div></div>
</div></body></html>`;
const pngs = [
  ['icon-192.png', icon({ bg: C.green, fg: C.lime, size: 192 }), 192],
  ['icon-512.png', icon({ bg: C.green, fg: C.lime, size: 512 }), 512],
  ['icon-maskable-512.png', icon({ bg: C.green, fg: C.lime, size: 512, scale: 0.46, radius: 0 }), 512],
  ['apple-touch-icon.png', icon({ bg: C.green, fg: C.lime, size: 180, scale: 0.54, radius: 0 }), 180],
  ['favicon-32.png', icon({ bg: C.green, fg: C.lime, size: 32, scale: 0.68, radius: 0.24 }), 32],
  ['identity/wordmark-ink.png', `<div style="background:transparent;padding:0">${wordmark(C.ink).replace(/width="[^"]+" height="[^"]+"/, 'width="1296" height="421"')}</div>`, [1296, 421]],
  ['identity/wordmark-white.png', `<div>${wordmark(C.white).replace(/width="[^"]+" height="[^"]+"/, 'width="1296" height="421"')}</div>`, [1296, 421]],
  ['identity/wordmark-lime.png', `<div>${wordmark(C.lime).replace(/width="[^"]+" height="[^"]+"/, 'width="264" height="86"')}</div>`, [264, 86]],
  ['identity/wordmark-green.png', `<div>${wordmark(C.green).replace(/width="[^"]+" height="[^"]+"/, 'width="1296" height="421"')}</div>`, [1296, 421]],
  ['og-image.png', og, [1200, 630]],
];
(async () => {
  const b = await chromium.launch();
  for (const [f, html, sz] of pngs) {
    const [w, h] = Array.isArray(sz) ? sz : [sz, sz];
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${html}`, { waitUntil: 'networkidle' });
    if (f === 'og-image.png') await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(OUT, f), omitBackground: true });
    await p.close();
  }
  await b.close();
  console.log('ok');
})();
