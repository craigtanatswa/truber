// Writes mobile/deploy/vercel.json with a Content-Security-Policy-Report-Only
// header. Hashes come from the inline <script> blocks in the HTML that will
// be served, so rerun this after a build that changes the splash script.
//
// The policy is console-only. It does not set report-uri or report-to, and
// this script refuses to add either. Violations show in the browser console
// until the policy is ready to enforce.
//
// Live build (connect-src must include the API origin):
//   flutter build web --no-web-resources-cdn \
//     --dart-define=TRUBER_DATA=live \
//     --dart-define=API_BASE_URL=https://api.example.com
//   node mobile/deploy/write_csp.mjs \
//     --index mobile/build/web/index.html \
//     --api-origin https://api.example.com
//
// CanvasKit is self-hosted (--no-web-resources-cdn). Measured with Flutter
// 3.24.5: chromium/canvaskit.wasm 5.12 MB, canvaskit.wasm 6.44 MB,
// skwasm.wasm 3.07 MB. The whole build/web tree is 23.8 MB. Vercel Hobby
// allows 100 MB for the deployment, not 8 MB per file. Roboto regular is
// vendored at web/fonts/roboto/v20/. The font path is set in
// web/flutter_bootstrap.js (fontFallbackBaseUrl), not by patching build output.
// Noto fallback faces are not vendored.

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
const outPath = path.resolve(flag('--out', 'mobile/deploy/vercel.json'));
const apiOrigin = flag('--api-origin', '');

if (apiOrigin) {
  let origin;
  try {
    origin = new URL(apiOrigin);
  } catch {
    console.error(`--api-origin must be an absolute URL, got ${apiOrigin}`);
    process.exit(1);
  }
  if (origin.origin !== apiOrigin || (origin.protocol !== 'https:' && origin.protocol !== 'http:')) {
    console.error(`--api-origin must be an exact http(s) origin, got ${apiOrigin}`);
    process.exit(1);
  }
}

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

if (/script-src[^;]*'unsafe-inline'/.test(policy)) {
  console.error('script-src must not contain unsafe-inline');
  process.exit(1);
}
if (/report-uri|report-to/i.test(policy)) {
  console.error('policy stays console-only: no report-uri or report-to');
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
