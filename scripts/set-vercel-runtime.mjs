// The current Astro adapter recognizes Node 24 but Vercel also supports Node 26.
// Keep generated function metadata aligned with the explicitly pinned build runtime.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = '.vercel/output/functions';
let count = 0;
async function visit(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (entry.name === '.vc-config.json') {
      const config = JSON.parse(await readFile(file, 'utf8'));
      if (config.runtime?.startsWith('nodejs')) {
        config.runtime = 'nodejs26.x';
        await writeFile(file, JSON.stringify(config, null, 2) + '\n');
        count++;
      }
    }
  }
}
await visit(root);
if (!count) throw new Error('No generated Node functions found; inspect the Astro adapter output.');
console.log(`Configured ${count} Vercel function(s) for Node 26.`);
