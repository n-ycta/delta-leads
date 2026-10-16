import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
export async function atomicJson(file, value) {
  const tmp = file + '.' + randomUUID() + '.tmp';
  await writeFile(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  await rename(tmp, file);
}
export class Store {
  constructor(dir) {
    this.dir = dir;
    this.file = join(dir, 'state.json');
    this.data = {
      format: 1,
      posts: [],
      seen: {},
      sources: {},
      scans: [],
      totals: { scanned: 0, leads: 0, competitors: 0, excluded: 0, sent: 0 },
      lastScanAt: 0,
    };
    this.tail = Promise.resolve();
  }
  async load() {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    await chmod(this.dir, 0o700);
    try {
      const d = JSON.parse(await readFile(this.file, 'utf8'));
      if (d.format !== 1 || !Array.isArray(d.posts) || !d.seen || !d.totals)
        throw Error('Invalid state file');
      this.data = d;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    return this;
  }
  save() {
    const snapshot = structuredClone(this.data);
    const next = this.tail.then(() => atomicJson(this.file, snapshot));
    this.tail = next.catch(() => {});
    return next;
  }
  trim(s, now = Date.now()) {
    const since = now - s.retentionDays * 86400000;
    this.data.posts = this.data.posts.filter((p) => p.detectedAt >= since).slice(-5000);
    this.data.seen = Object.fromEntries(
      Object.entries(this.data.seen)
        .filter(([, v]) => v >= since)
        .slice(-30000),
    );
    this.data.scans = this.data.scans.filter((p) => p.ts >= since).slice(-3000);
  }
}
