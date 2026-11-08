import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] || 'dist';
const fail = (message) => { throw new Error(message); };
for (const file of ['index.html', 'sw.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'licenses/WebReader-MIT.txt', 'licenses/PDFjs-Apache-2.0.txt', 'pdf-assets/cmaps', 'pdf-assets/standard_fonts', 'pdf-assets/wasm', 'samples/reading-sample.pdf'])
  if (!existsSync(join(root, file))) fail(`Missing release asset: ${file}`);
const manifest = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
if (manifest.display !== 'standalone' || manifest.start_url !== './' || manifest.scope !== './') fail('Manifest must launch inside the deployment directory.');
function files(dir) { return readdirSync(dir).flatMap((name) => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : [path]; }); }
for (const path of files(root)) {
  if (!/\.(html|js|css|webmanifest|json|txt)$/.test(path)) continue;
  const text = readFileSync(path, 'utf8');
  if (/\bsk-[a-zA-Z0-9_-]{16,}/.test(text)) fail(`Possible API credential in build: ${path}`);
  // Dexie contains a localhost *detection regexp*; reject actual local endpoint URLs instead.
  if (/assets[\\/]index-[^\\/]+\.js$/.test(path) && /https?:\/\/(?:localhost|127\.0\.0\.1)(?=[:/])|\/api\/translation|DEEPSEEK_API_KEY|Folio DEV diagnostics/.test(text)) fail(`Development dependency in production entry: ${path}`);
}
const html = readFileSync(join(root, 'index.html'), 'utf8');
if (!html.includes('Content-Security-Policy') || !html.includes('https://api.deepseek.com')) fail('Missing production CSP.');
console.log('Release checks passed: assets, manifest, licenses, CSP, no embedded key or local proxy dependency.');
