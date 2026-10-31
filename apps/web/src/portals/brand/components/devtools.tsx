import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { CopyButton } from './common';

/** Dark code block with copy — always LTR. */
export function CodeBlock({ code, className, lang }: { code: string; className?: string; lang?: string }) {
  return (
    <div className={cn('group relative min-w-0 max-w-full overflow-hidden rounded-xl bg-ink-950 ring-1 ring-ink-800', className)} dir="ltr">
      {lang && <span className="absolute start-3 top-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500">{lang}</span>}
      <CopyButton value={code} size="xs" className="absolute end-2 top-1.5 text-ink-400 hover:bg-ink-800 hover:text-white" />
      <pre className={cn('max-h-[420px] overflow-auto px-4 pb-4 text-[12.5px] leading-relaxed text-ink-100', lang ? 'pt-7' : 'pt-4')}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** Secret value shown once/revealed with copy. */
export function SecretBox({ value, label }: { value: string; label?: ReactNode }) {
  return (
    <div>
      {label && <p className="mb-1 text-xs font-medium text-ink-500">{label}</p>}
      <div className="flex items-center gap-2 rounded-xl border border-ink-200 bg-ink-50 p-2 ps-3 dark:border-ink-700 dark:bg-ink-950" dir="ltr">
        <code className="min-w-0 flex-1 break-all font-mono text-sm text-ink-900 dark:text-ink-50">{value}</code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

export function LangTabs({ tabs }: { tabs: Array<{ key: string; label: string; code: string }> }) {
  const [active, setActive] = useState(tabs[0]?.key);
  const cur = tabs.find((t) => t.key === active) ?? tabs[0];
  return (
    <div>
      <div className="mb-2 flex gap-1" dir="ltr">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={cn('rounded-lg px-3 py-1 text-xs font-semibold transition', t.key === cur.key ? 'bg-ink-900 text-white dark:bg-white dark:text-ink-900' : 'text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <CodeBlock code={cur.code} />
    </div>
  );
}

export function snippets(base: string) {
  const body = `{
    "brandReference": "1042",
    "recipient": { "name": "Mohamed Hassan", "phone": "01012345678" },
    "address": { "line": "12 Makram Ebeid St, Nasr City", "building": "12", "floor": "3", "apartment": "7" },
    "package": { "description": "2 t-shirts", "itemsCount": 2, "weightGrams": 800 },
    "paymentMethod": "COD",
    "codAmountCents": 45000,
    "serviceLevel": "STANDARD"
  }`;
  return {
    create: [
      {
        key: 'curl',
        label: 'cURL',
        code: `curl -X POST ${base}/orders \\
  -H "X-Api-Key: $GOTURTLE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${body.replace(/\n {2}/g, '\n')}'`,
      },
      {
        key: 'js',
        label: 'JavaScript',
        code: `const res = await fetch('${base}/orders', {
  method: 'POST',
  headers: {
    'X-Api-Key': process.env.GOTURTLE_API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(${body.replace(/"(\w+)":/g, '$1:').replace(/\n {2}/g, '\n  ')}),
});
if (!res.ok) throw new Error((await res.json()).message);
const order = await res.json();
console.log(order.trackingNumber); // e.g. GT4829150376`,
      },
      {
        key: 'php',
        label: 'PHP',
        code: `<?php
$payload = [
  'brandReference' => '1042',
  'recipient' => ['name' => 'Mohamed Hassan', 'phone' => '01012345678'],
  'address' => ['line' => '12 Makram Ebeid St, Nasr City'],
  'package' => ['itemsCount' => 2, 'weightGrams' => 800],
  'paymentMethod' => 'COD',
  'codAmountCents' => 45000, // 450 EGP in piasters
];
$ch = curl_init('${base}/orders');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    'X-Api-Key: ' . getenv('GOTURTLE_API_KEY'),
    'Content-Type: application/json',
  ],
  CURLOPT_POSTFIELDS => json_encode($payload),
]);
$order = json_decode(curl_exec($ch), true);
echo $order['trackingNumber'];`,
      },
    ],
    verify: [
      {
        key: 'node',
        label: 'Node.js (Express)',
        code: `import crypto from 'node:crypto';
import express from 'express';

const app = express();
// Keep the raw body: the signature covers the exact bytes we sent.
app.post('/webhooks/goturtle', express.raw({ type: 'application/json' }), (req, res) => {
  const header = req.get('X-GoTurtle-Signature') ?? ''; // "t=1730000000,v1=5f2b…"
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));
  const expected = crypto
    .createHmac('sha256', process.env.GOTURTLE_WEBHOOK_SECRET)
    .update(\`\${parts.t}.\${req.body}\`)
    .digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;
  const valid = parts.v1 && expected.length === parts.v1.length
    && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  if (!valid || !fresh) return res.sendStatus(401);

  const event = JSON.parse(req.body);
  // event.id is stable across retries — use it to de-duplicate.
  console.log(req.get('X-GoTurtle-Event'), event.data);
  res.sendStatus(200);
});`,
      },
      {
        key: 'php',
        label: 'PHP',
        code: `<?php
$raw = file_get_contents('php://input');
$header = $_SERVER['HTTP_X_GOTURTLE_SIGNATURE'] ?? '';
parse_str(str_replace(',', '&', $header), $parts); // t=…&v1=…
$expected = hash_hmac('sha256', $parts['t'] . '.' . $raw, getenv('GOTURTLE_WEBHOOK_SECRET'));
$fresh = abs(time() - (int) $parts['t']) < 300;
if (!$fresh || !hash_equals($expected, $parts['v1'] ?? '')) {
  http_response_code(401);
  exit;
}
$event = json_decode($raw, true);
// $event['id'] is stable across retries — de-duplicate on it.
http_response_code(200);`,
      },
    ],
  };
}
