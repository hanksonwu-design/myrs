// Runs after `next build` (npm "postbuild"). The static export writes prefetch
// files as orders/__next.orders/__PAGE__.txt, but the browser asks for
// orders/__next.orders.__PAGE__.txt; plain static hosts (GitHub Pages) cannot
// rewrite that, so prefetching 404s. Add a copy under the requested name.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'out');
if (!fs.existsSync(out)) process.exit(0);

let copied = 0;
function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === '_next') continue;
    const full = path.join(dir, e.name);
    if (e.name.startsWith('__next.')) {
      for (const file of filesUnder(full)) {
        const flat = path.relative(dir, file).split(path.sep).join('.');
        const target = path.join(dir, flat);
        if (!fs.existsSync(target)) {
          fs.copyFileSync(file, target);
          copied++;
        }
      }
    } else {
      walk(full);
    }
  }
}
walk(out);
console.log(`flatten-segments: ${copied} prefetch files added`);
