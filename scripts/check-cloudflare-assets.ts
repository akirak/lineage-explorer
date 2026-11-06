import { access, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

// Workers Static Assets limits on the Free plan. Fail before uploading rather
// than silently depending on a paid resource (e.g. R2) for oversized files.
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_ASSETS = 20_000;

export async function checkCloudflareAssets(directory = 'dist/client'): Promise<void> {
  await access(path.join(directory, 'index.html'));
  let count = 0;
  async function check(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await check(file);
      } else if (entry.isFile()) {
        count++;
        if ((await stat(file)).size > MAX_ASSET_BYTES) {
          throw new Error(`${file} exceeds Cloudflare's 25 MiB static asset limit`);
        }
      }
    }
  }
  await check(directory);
  if (count > MAX_ASSETS) {
    throw new Error(`${count} assets exceeds Cloudflare Free's ${MAX_ASSETS} asset limit`);
  }
  console.log(`[cloudflare] ${count} static assets fit the Free plan limits`);
}

if (import.meta.main) await checkCloudflareAssets();
