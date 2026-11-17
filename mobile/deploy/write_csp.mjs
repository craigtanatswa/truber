// Writes mobile/deploy/vercel.json with a Content-Security-Policy-Report-Only
// header. Script hashes come from the inline <script> blocks in the HTML that
// will be served, so a rebuild that changes the splash script stays valid
// after this script is run again.
//
// Usage (after `flutter build web --no-web-resources-cdn`):
//   node mobile/deploy/write_csp.mjs \
//     --index mobile/build/web/index.html \
//     --bootstrap mobile/build/web/flutter_bootstrap.js
//
// CanvasKit wasm in the Flutter 3.24.5 engine build:
//   chromium/canvaskit.wasm  5.12 MB
//   canvaskit.wasm           6.44 MB
//   skwasm.wasm              3.07 MB
// All are under the 8 MB per-file upload limit, so the web build should use
// --no-web-resources-cdn and serve canvaskit/ from the build. Roboto regular
// is vendored at web/fonts/roboto/v20/. Noto fallback faces are still fetched
// by path under fontFallbackBaseUrl; this script points that at fonts/.
//
// Optional: --api-origin https://api.example.com
// adds that exact origin to connect-src. Default is 'self' only.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function flag(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  return args[i + 1];
}

const indexPath = path.resolve(flag('--index', 'mobile/build/web/index.html'));
const bootstrapPath = path.resolve(
  flag('--bootstrap', 'mobile/build/web/flutter_bootstrap.js'),
);
const outPath = path.resolve(flag('--out', 'mobile/deploy/vercel.json'));
const apiOrigin = flag('--api-origin', '');

const html = fs.readFileSync(indexPath, 'utf8');
const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const hashes = [];
let match;
while ((match = scriptRe.exec(html))) {
  if (/\bsrc\s*=/i.test(match[1])) continue;
  const body = match[2];
  if (!body.trim()) continue;
  const digest = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
  hashes.push(`'sha256-${digest}'`);
}

if (hashes.length === 0) {
  console.error(`no inline script found in ${indexPath}`);
  process.exit(1);
}

if (fs.existsSync(bootstrapPath)) {
  let js = fs.readFileSync(bootstrapPath, 'utf8');
  if (!js.includes('fontFallbackBaseUrl')) {
    js = js.replace(
      '_flutter.loader.load({',
      '_flutter.loader.load({\n  config: { fontFallbackBaseUrl: "fonts/" },',
    );
    fs.writeFileSync(bootstrapPath, js);
    console.log(`patched fontFallbackBaseUrl in ${bootstrapPath}`);
  }
}

const connect = ["'self'"];
if (apiOrigin) connect.push(apiOrigin);

const policy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src ${connect.join(' ')}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "manifest-src 'self'",
].join('; ');

if (policy.includes("'unsafe-inline'") && policy.includes('script-src') &&
    /script-src[^;]*'unsafe-inline'/.test(policy)) {
  console.error('script-src must not contain unsafe-inline');
  process.exit(1);
}

const vercel = {
  headers: [
    {
      source: '/(.*)',
      headers: [
        {
          key: 'Content-Security-Policy-Report-Only',
          value: policy,
        },
      ],
    },
  ],
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(vercel, null, 2)}\n`);
console.log(`wrote ${outPath}`);
console.log(`script hashes: ${hashes.join(' ')}`);
console.log(policy);
