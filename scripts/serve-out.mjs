// Serves the static build in out/ the way GitHub Pages does, to check it
// before publishing:  PAGES_BASE_PATH=/myrs npm run build && npm run preview
// (/myrs/orders -> out/orders.html, unknown paths -> out/404.html).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
const base = process.env.PAGES_BASE_PATH ?? '/myrs';
const port = Number(process.env.PORT ?? 4000);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain', '.woff2': 'font/woff2',
};

function find(p) {
  for (const c of [p, `${p}.html`, path.join(p, 'index.html')]) {
    if (c.startsWith(root) && fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/') return res.writeHead(302, { location: `${base}/` }).end();
    const file = url.startsWith(base) ? find(path.join(root, url.slice(base.length))) : null;
    const status = file ? 200 : 404;
    const body = file ?? path.join(root, '404.html');
    res.writeHead(status, { 'content-type': types[path.extname(body)] ?? 'application/octet-stream' });
    fs.createReadStream(body).pipe(res);
  })
  .listen(port, () => console.log(`serving out/ at http://localhost:${port}${base}/`));
