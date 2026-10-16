import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('package manifest and dependency lock versions agree; no token-admin/storage privileges', async () => {
  const read = async (f) => JSON.parse(await readFile(new URL('../' + f, import.meta.url), 'utf8'));
  const [m, p, l] = await Promise.all(
    ['manifest.json', 'package.json', 'package-lock.json'].map(read),
  );
  assert.equal(m.version, p.version);
  assert.equal(m.metadata.ui.version, p.version);
  assert.equal(l.version, p.version);
  assert.equal(l.packages[''].version, p.version);
  assert.equal(m.id, 'leads');
  assert.equal(m.metadata.ui.contract, '^1.5.0');
  assert(m.capabilities.every((c) => c.admin));
  assert(m.metadata.ui.views.every((v) => v.capability.startsWith('leads.')));
  assert(
    m.metadata.ui.settings
      .filter((f) => f.type === 'secret')
      .every((f) => !Object.hasOwn(f, 'default')),
  );
});
