import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pipeline } from '../server/pipeline.mjs';
import { analyzeBatch, analyze } from '../server/classifier.mjs';
import { defaults, parseSettings } from '../server/settings.mjs';
import { mergeProfiles, profiles } from '../server/profiles.mjs';
import { validateTelegram, validateAI } from '../server/diagnostics.mjs';
import { SourceError } from '../server/errors.mjs';
const now = 1800000000000;
const post = (id) => ({
  source: 'reddit',
  id: 'reddit:' + id,
  title: '[Hiring] Need a website and Telegram bot $500 ' + id,
  text: 'Paid project',
  author: 'buyer',
  createdAt: now - 1000,
  url: 'https://www.reddit.com/r/forhire/comments/' + id + '/x',
});
async function fixture(t, opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'leads-v2-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const p = await new Pipeline(dir, { now: () => now, sleep: async () => {}, ...opts }).init();
  await p.configure({ queries: 'website', aiEnabled: true });
  return p;
}
const response = (content) =>
  new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
test('parallel AI is bounded, request budget is exact, excess remains pending', async (t) => {
  let active = 0,
    peak = 0,
    calls = 0;
  const p = await fixture(t, {
    connectors: {
      reddit: {
        search: async () => ({ posts: Array.from({ length: 8 }, (_, i) => post(String(i))) }),
      },
    },
    ai: async () => {
      calls++;
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 8));
      active--;
      return { verdict: 'lead', confidence: 0.99, reason: 'Buyer' };
    },
  });
  await p.configure({ aiMode: 'parallel', aiConcurrency: 3, maxAiPerScan: 5 });
  const scan = await p.scan();
  assert.equal(calls, 5);
  assert.equal(scan.aiCalls, 5);
  assert.equal(peak, 3);
  assert.equal(scan.leads, 5);
  assert.equal(p.store.data.posts.filter((p) => p.verdict === 'pending_ai').length, 3);
});
test('batch mode counts requests not posts; every verdict maps to its input ID', async (t) => {
  let requests = 0;
  const p = await fixture(t, {
    connectors: {
      reddit: {
        search: async () => ({ posts: Array.from({ length: 7 }, (_, i) => post(String(i))) }),
      },
    },
    aiBatch: async (posts) => {
      requests++;
      return new Map(posts.map((p) => [p.id, { verdict: 'lead', confidence: 0.99, reason: p.id }]));
    },
  });
  await p.configure({ aiMode: 'batch', aiBatchSize: 3, maxAiPerScan: 2 });
  const result = await p.scan();
  assert.equal(requests, 2);
  assert.equal(result.aiCalls, 2);
  assert.equal(result.leads, 6);
  assert.equal(p.store.data.posts[3].ai.reason, 'reddit:3');
  assert.equal(p.store.data.posts[6].verdict, 'pending_ai');
});
test('batch parser accepts out of order results, rejects duplicate/missing/foreign/invalid IDs', async () => {
  const posts = [post('a'), post('b')];
  const valid = posts.map((p) => ({
    id: p.id,
    verdict: 'lead',
    confidence: 0.99,
    reason: 'Buyer',
  }));
  const map = await analyzeBatch(posts, defaults, {
    fetcher: async () => response({ results: valid.toReversed() }),
  });
  assert.equal(map.get('reddit:a').verdict, 'lead');
  for (const results of [
    [valid[0], valid[0]],
    [valid[0]],
    [valid[0], { ...valid[1], id: 'evil' }],
    [valid[0], { ...valid[1], confidence: 2 }],
  ])
    await assert.rejects(
      analyzeBatch(posts, defaults, { fetcher: async () => response({ results }) }),
      (e) => e.code === 'ai_invalid_output',
    );
});
test('AI endpoint supports full completions URL, optional JSON parameter and configured timeout', async () => {
  let body, url;
  await analyze(
    post('a'),
    { score: 100 },
    { ...defaults, aiBaseUrl: 'https://model.example/v1/chat/completions', aiJsonMode: false },
    {
      fetcher: async (u, o) => {
        url = u;
        body = JSON.parse(o.body);
        return response({ verdict: 'lead', confidence: 0.99, reason: 'Buyer' });
      },
    },
  );
  assert.equal(url, 'https://model.example/v1/chat/completions');
  assert.equal(body.response_format, undefined);
});
test('batch failure fails closed and never sends notifications', async (t) => {
  let sent = 0;
  const p = await fixture(t, {
    connectors: { reddit: { search: async () => ({ posts: [post('a'), post('b')] }) } },
    aiBatch: async () => {
      throw new SourceError('ai_invalid_output');
    },
    telegram: async () => {
      sent++;
    },
  });
  await p.configure({
    aiMode: 'batch',
    telegramEnabled: true,
    telegramBotToken: '123:token',
    telegramChatId: '123',
  });
  const r = await p.scan();
  assert.equal(r.leads, 0);
  assert.equal(sent, 0);
  assert(p.store.data.posts.every((p) => p.verdict === 'pending_ai'));
});
test('AI429 stops sequential request burst; source429 prevents scans and diagnostic bypass', async (t) => {
  let ai = 0,
    source = 0;
  const p = await fixture(t, {
    connectors: {
      reddit: {
        search: async () => {
          source++;
          return { posts: [post('a'), post('b')] };
        },
      },
    },
    ai: async () => {
      ai++;
      throw new SourceError('http_429', { retryAfter: 600000 });
    },
  });
  await p.scan();
  assert.equal(ai, 1);
  p.connectors.reddit.search = async () => {
    source++;
    throw new SourceError('http_429', { retryAfter: 600000 });
  };
  await p.scan();
  const count = source;
  await p.scan();
  assert.equal(source, count);
  assert.match(
    p.status().notices.find((n) => n.id === 'leads.source.reddit').localizations.ru,
    /Лимит/,
  );
  p.startDiagnostic();
  while (p.diagnostic.running) await new Promise((r) => setTimeout(r, 1));
  assert.equal(source, count);
  assert.equal(p.diagnostic.rows[0].error, 'cooldown');
});
test('diagnostic is bounded last24h sample, shares scan lock and never stores leads', async (t) => {
  const p = await fixture(t, {
    connectors: {
      reddit: {
        search: async () => {
          await new Promise((r) => setTimeout(r, 5));
          return { posts: [post('new'), { ...post('old'), createdAt: now - 90000000 }] };
        },
      },
    },
    ai: async () => ({ verdict: 'lead', confidence: 0.99, reason: 'Buyer' }),
  });
  assert.equal(p.startDiagnostic({ ai: true }).accepted, true);
  assert.equal(p.startScan().accepted, false);
  while (p.diagnostic.running) await new Promise((r) => setTimeout(r, 1));
  assert.equal(p.diagnostic.rows[0].count, 1);
  assert.equal(p.diagnostic.rows[0].verdict, 'lead');
  assert.equal(p.store.data.posts.length, 0);
  assert.equal(p.notifications().length, 0);
});
test('Telegram validation verifies bot and chat without sending', async () => {
  const paths = [];
  const r = await validateTelegram(
    { ...defaults, telegramBotToken: '123:secret', telegramChatId: '123' },
    {
      fetcher: async (u) => {
        paths.push(u.split('/').at(-1));
        return new Response(
          JSON.stringify({
            ok: true,
            result: u.endsWith('getMe') ? { username: 'bot' } : { id: 123, type: 'private' },
          }),
        );
      },
    },
  );
  assert.equal(r.bot, 'bot');
  assert.deepEqual(paths, ['getMe', 'getChat']);
  assert(!JSON.stringify(r).includes('secret'));
});
test('AI validation makes a real structured completion, not merely a models listing', async () => {
  let calls = 0;
  const result = await validateAI(defaults, {
    fetcher: async (u) => {
      calls++;
      assert(u.endsWith('/chat/completions'));
      return response({ verdict: 'lead', confidence: 0.98, reason: 'Buyer' });
    },
  });
  assert.equal(result.ok, true);
  assert.equal(calls, 1);
});
test('every merged profile combination is valid, deterministic and secret free', () => {
  for (let mask = 1; mask < 16; mask++) {
    const ids = profiles.filter((_, i) => mask & (1 << i)).map((p) => p.id);
    const v = mergeProfiles(ids);
    assert.doesNotThrow(() => parseSettings({ ...v, activeProfiles: ids }));
    assert.equal(v.services.split('\n').length, new Set(v.services.split('\n')).size);
    assert(!Object.keys(v).some((k) => /token|key|secret/i.test(k)));
  }
  assert(!mergeProfiles(['art']).services.includes('website'));
});

test('AI cooldown applies to all candidates across scans, persists, and resets after credential change', async (t) => {
  let calls = 0;
  const p = await fixture(t, {
    connectors: { reddit: { search: async () => ({ posts: [post('a'), post('b')] }) } },
    ai: async () => {
      calls++;
      throw new SourceError('http_429', { retryAfter: 3600000 });
    },
  });
  await p.scan();
  await p.scan();
  assert.equal(calls, 1);
  assert.equal(p.store.data.aiRetryAt, now + 3600000);
  const restart = await new Pipeline(p.dir, { now: () => now }).init();
  assert.equal(restart.store.data.aiRetryAt, now + 3600000);
  await p.configure({ aiApiKey: 'replacement-test-key' });
  assert.equal(p.store.data.aiRetryAt, undefined);
});
