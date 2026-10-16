import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pipeline } from '../server/pipeline.mjs';
import { SourceError } from '../server/errors.mjs';
const now = 1800000000000;
const post = (id = '1', extra = {}) => ({
  id: 'reddit:' + id,
  source: 'reddit',
  title: '[Hiring] Need a website and Telegram bot, budget $300 ' + id,
  text: 'Paid project',
  createdAt: now - 10000,
  url: 'https://www.reddit.com/r/forhire/comments/' + id + '/x',
  author: 'buyer',
  ...extra,
});
async function fixture(t, opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'leads-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const pipeline = await new Pipeline(dir, {
    now: () => now,
    sleep: async () => {},
    ...opts,
  }).init();
  await pipeline.configure({ queries: 'website' });
  return pipeline;
}
test('deduplicates repeated pages and persists through restart', async (t) => {
  const p = await fixture(t, {
    connectors: { reddit: { search: async () => ({ posts: [post(), post()], cursor: null }) } },
  });
  const a = await p.scan();
  assert.equal(a.leads, 1);
  assert.equal(a.scanned, 1);
  assert.equal((await p.scan()).scanned, 0);
  const restarted = await new Pipeline(p.dir).init();
  assert.equal(restarted.list().total, 1);
  assert.equal(restarted.notifications().length, 1);
  assert.equal((await stat(join(p.dir, 'settings.json'))).mode & 0o777, 0o600);
});
test('exact content crossposts deduplicated without blocking unrelated posts', async (t) => {
  const p = await fixture(t, {
    connectors: {
      reddit: {
        search: async () => ({
          posts: [post(), post('2', { title: post().title }), post('3')],
          cursor: null,
        }),
      },
    },
  });
  assert.equal((await p.scan()).leads, 2);
});
test('competitors, old posts and unmatched posts never sent', async (t) => {
  let sent = 0;
  const p = await fixture(t, {
    telegram: async () => {
      sent++;
      return {};
    },
    connectors: {
      reddit: {
        search: async () => ({
          posts: [
            post('1', { title: '[For Hire] Need a website? Hire me!' }),
            post('2', { createdAt: now - 30 * 3600000 }),
            post('3', { title: 'My day at work' }),
          ],
          cursor: null,
        }),
      },
    },
  });
  await p.configure({
    telegramEnabled: true,
    telegramBotToken: '123:secret',
    telegramChatId: '42',
  });
  await p.scan();
  assert.equal(sent, 0);
  assert.equal(p.notifications().length, 0);
  assert.equal(p.list({ verdict: 'competitor' }).total, 1);
});
test('AI errors fail closed, consume bounded budget and retry durably', async (t) => {
  let calls = 0;
  const p = await fixture(t, {
    ai: async () => {
      calls++;
      throw new SourceError('http_503');
    },
    connectors: { reddit: { search: async () => ({ posts: [post(), post('2')], cursor: null }) } },
  });
  await p.configure({ aiEnabled: true, maxAiPerScan: 1 });
  const r = await p.scan();
  assert.equal(calls, 1);
  assert.equal(r.leads, 0);
  assert.equal(p.list({ verdict: 'pending_ai' }).total, 2);
  assert.equal(p.notifications().length, 0);
  assert.equal(
    JSON.parse(await readFile(join(p.dir, 'state.json'), 'utf8')).posts[0].verdict,
    'pending_ai',
  );
});
test('AI rejection verdict and reason remain visible without notifying', async (t) => {
  const p = await fixture(t, {
    ai: async () => ({
      verdict: 'competitor',
      confidence: 0.99,
      reason: 'Seller posting',
      model: 'test',
    }),
    connectors: { reddit: { search: async () => ({ posts: [post()], cursor: null }) } },
  });
  await p.configure({ aiEnabled: true });
  await p.scan();
  assert.equal(p.list().rows[0].verdict, 'competitor');
  assert.equal(p.list().rows[0].reason, 'Seller posting');
  assert.equal(p.notifications().length, 0);
});
test('Telegram transient failure queues retry; permanent failure is visible', async (t) => {
  const p = await fixture(t, {
    telegram: async () => {
      throw new SourceError('http_429', { retryAfter: 300000 });
    },
    connectors: { reddit: { search: async () => ({ posts: [post()], cursor: null }) } },
  });
  await p.configure({
    telegramEnabled: true,
    telegramBotToken: '123:secret',
    telegramChatId: '42',
  });
  await p.scan();
  const d = p.store.data.posts[0].delivery;
  assert.equal(d.state, 'retry');
  assert(d.nextAt >= now + 300000);
  assert.equal(p.notifications().length, 1);
  p.telegram = async () => {
    throw new SourceError('http_403', { permanent: true });
  };
  d.nextAt = 0;
  await p.scan();
  assert.equal(p.list().rows[0].delivery, 'failed');
});
test('sent Telegram is not repeated on next scan or after restart', async (t) => {
  let sends = 0;
  const p = await fixture(t, {
    telegram: async () => ({ messageId: ++sends }),
    connectors: { reddit: { search: async () => ({ posts: [post()], cursor: null }) } },
  });
  await p.configure({
    telegramEnabled: true,
    telegramBotToken: '123:secret',
    telegramChatId: '42',
  });
  await p.scan();
  await p.scan();
  assert.equal(sends, 1);
  assert.equal(p.store.data.posts[0].delivery.state, 'sent');
});
test('source backoff is persisted and no auth-block bypass fallback occurs', async (t) => {
  let calls = 0;
  const p = await fixture(t, {
    connectors: {
      reddit: {
        search: async () => {
          calls++;
          throw new SourceError('http_403', { permanent: true });
        },
      },
    },
  });
  await p.scan();
  await p.scan();
  assert.equal(calls, 1);
  assert.equal(p.status().sources.reddit.error, 'http_403');
});
test('concurrent scans and invalid data queries rejected', async (t) => {
  const p = await fixture(t);
  p.running = true;
  assert.deepEqual(await p.scan(), { skipped: true });
  p.running = false;
  assert.throws(() => p.list({ limit: 101 }));
  assert.throws(() => p.metrics({ metricId: 'bad' }));
  assert.equal(p.preview({ title: 'Нужен сайт, оплачу' }).verdict, 'lead');
});
test('settings writes serialized without lost updates or credential leaks', async (t) => {
  const p = await fixture(t);
  await Promise.all([
    p.configure({ intervalSec: 600 }),
    p.configure({ freshnessHours: 12 }),
    p.configure({ aiApiKey: 'private-ai-key' }),
  ]);
  assert.equal(p.settings.intervalSec, 600);
  assert.equal(p.settings.freshnessHours, 12);
  assert(!JSON.stringify(p.status()).includes('private-ai-key'));
  assert(p.status().settings._configuredSecrets.includes('aiApiKey'));
});
test('page limit reports partial coverage; feedback and metrics work', async (t) => {
  let pages = 0;
  const p = await fixture(t, {
    connectors: {
      reddit: { search: async () => ({ posts: [post(String(++pages))], cursor: 'next' }) },
    },
  });
  await p.scan();
  assert.equal(pages, 3);
  assert.equal(p.status().sources.reddit.partial, true);
  await p.feedback({ id: 'reddit:1', review: 'false_positive' });
  assert.equal(p.list().rows.find((p) => p.id === 'reddit:1').review, 'false_positive');
  assert.equal(
    p.metrics({ metricId: 'leads', range: { from: now - 1000, to: now + 1000 }, stepMs: 1000 })
      .summary.current,
    3,
  );
});

test('localized tables preserve machine-readable verdicts and translate human labels', async (t) => {
  const p = await fixture(t, {
    connectors: { reddit: { search: async () => ({ posts: [post()], cursor: null }) } },
  });
  await p.scan();
  const ru = p.list({ _locale: 'ru' }).rows[0],
    en = p.list({ _locale: 'en' }).rows[0];
  assert.equal(ru.verdict, 'lead');
  assert.equal(ru.verdictLabel, 'Лид');
  assert.equal(en.verdictLabel, 'Lead');
  assert.equal(ru.deliveryLabel, 'Отключено');
  assert.match(ru.reason, /Заказчик/);
  assert.equal(p.stats({ _locale: 'ru' }).rows[0].metric, 'Проверено уникальных постов');
});

test('real dashboard time presets, automatic buckets and previous-period result contract', async (t) => {
  const p = await fixture(t);
  p.store.data.scans = [
    { ts: now - 1000, leads: 2 },
    { ts: now - 86400000 - 1000, leads: 3 },
  ];
  for (const preset of ['15m', '1h', '6h', '24h', '7d', '30d', '90d']) {
    const r = p.metrics({ metricId: 'leads', range: { preset }, compare: 'previous' });
    assert(Number.isFinite(r.from));
    assert(Number.isFinite(r.to));
    assert(Number.isFinite(r.generatedAt));
    assert(r.stepMs >= 60000);
    assert(r.series[0].points.length <= 2000);
    assert.equal(r.query.range.preset, preset);
    assert(Array.isArray(r.compare[0].points));
  }
  const r = p.metrics({ metricId: 'leads', range: { preset: '24h' }, compare: 'previous' });
  assert.equal(r.summary.current, 2);
  assert.equal(r.summary.previous, 3);
  assert.equal(r.series[0].points[0].t, r.compare[0].points[0].t);
  for (const q of [
    { range: { preset: 'bad' } },
    { stepMs: 0 },
    { stepMs: 1 },
    { aggregation: 'avg' },
    { groupBy: 'unknown' },
  ])
    assert.throws(() => p.metrics({ metricId: 'leads', range: { preset: '24h' }, ...q }));
});
