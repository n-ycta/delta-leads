import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  redditRss,
  redditJson,
  RedditConnector,
  XConnector,
  ThreadsConnector,
  normalize,
  canonicalUrl,
} from '../server/connectors.mjs';
import { defaults } from '../server/settings.mjs';
import { sendTelegram } from '../server/telegram.mjs';
import { request } from '../server/net.mjs';
const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>t3_abc</id><title>[Hiring] Need website &amp; bot</title><author><name>/u/buyer</name></author><content type="html">&lt;p&gt;Budget $300&lt;/p&gt;</content><link href="https://www.reddit.com/r/forhire/comments/abc/test/"/><published>2026-10-16T05:00:00Z</published></entry></feed>`;
test('Reddit Atom normalized and external links rejected', () => {
  const { posts } = redditRss(xml);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, 'reddit:abc');
  assert.match(posts[0].title, /website & bot/);
  assert.equal(canonicalUrl('reddit', 'javascript:alert(1)'), null);
  assert.equal(canonicalUrl('reddit', 'https://evil.example/a'), null);
  assert.equal(
    normalize('reddit', { id: 'x', url: 'https://www.reddit.com/a', createdAt: 'invalid' }),
    null,
  );
});
test('DTD/entity declarations and non-feed errors rejected', () => {
  assert.throws(() => redditRss('<!DOCTYPE x><feed/>'));
  assert.throws(() => redditRss('<html>blocked</html>'));
  assert.throws(() => redditJson({ error: 403 }));
});
test('Reddit JSON cursor and exact permalink', () => {
  const r = redditJson({
    data: {
      after: 't3_next',
      children: [
        {
          data: {
            id: 'a',
            title: 'x',
            selftext: 'y',
            author: 'u',
            subreddit: 's',
            created_utc: 1700000000,
            permalink: '/r/s/comments/a/x/',
          },
        },
      ],
    },
  });
  assert.equal(r.cursor, 't3_next');
  assert.equal(r.posts[0].url, 'https://www.reddit.com/r/s/comments/a/x/');
});
test('Reddit OAuth token is cached and not sent to public RSS', async () => {
  let auth = 0,
    search = 0;
  const c = new RedditConnector(async (u, o) => {
    if (String(u).endsWith('/access_token')) {
      auth++;
      assert.match(o.body.toString(), /grant_type=client_credentials/);
      return Response.json({ access_token: 'private', expires_in: 3600 });
    }
    search++;
    assert.equal(new URL(u).hostname, 'oauth.reddit.com');
    assert.equal(o.headers.authorization, 'Bearer private');
    return Response.json({ data: { children: [], after: null } });
  });
  const s = {
    ...defaults,
    redditMode: 'oauth',
    redditClientId: 'id',
    redditClientSecret: 'secret',
  };
  await c.search('website', s);
  await c.search('bot', s);
  assert.equal(auth, 1);
  assert.equal(search, 2);
});
test('X and Threads official APIs use bearer headers and pagination', async () => {
  let xu, tu;
  const x = new XConnector(async (u, o) => {
    xu = new URL(u);
    assert.equal(o.headers.authorization, 'Bearer x');
    return Response.json({
      data: [
        { id: '1', text: 'Need a website', created_at: '2026-10-16T00:00:00Z', author_id: '2' },
      ],
      meta: { next_token: 'next' },
    });
  });
  assert.equal(
    (
      await x.search(
        'website',
        { ...defaults, xBearerToken: 'x' },
        { now: Date.parse('2026-10-16') },
      )
    ).cursor,
    'next',
  );
  assert.equal(xu.searchParams.get('max_results'), '100');
  const t = new ThreadsConnector(async (u, o) => {
    tu = new URL(u);
    assert.equal(o.headers.authorization, 'Bearer t');
    return Response.json({
      data: [
        {
          id: '3',
          text: 'Нужен бот',
          timestamp: '2026-10-16T00:00:00Z',
          permalink: 'https://www.threads.com/@a/post/a',
          username: 'a',
        },
      ],
    });
  });
  assert.equal(
    (await t.search('нужен бот', { ...defaults, threadsAccessToken: 't' })).posts.length,
    1,
  );
  assert.equal(tu.searchParams.get('search_mode'), 'KEYWORD');
  assert.equal(tu.searchParams.get('search_type'), 'RECENT');
});
test('rate limit and response limits preserve safe error codes', async () => {
  await assert.rejects(
    request('https://example.com', {
      fetcher: async () => new Response('', { status: 429, headers: { 'retry-after': '30' } }),
    }),
    (e) => e.code === 'http_429' && e.retryAfter === 30000,
  );
  await assert.rejects(
    request('https://example.com', { maxBytes: 2, fetcher: async () => new Response('too large') }),
    (e) => e.code === 'response_too_large',
  );
});
test('Telegram uses escaped HTML and validated inline URL; credentials never appear in result', async () => {
  let body;
  const p = {
    title: '<script>alert()</script>',
    source: 'reddit',
    author: 'buyer',
    createdAt: Date.now(),
    url: 'https://www.reddit.com/r/forhire/comments/1/x',
    rules: { score: 90, reason: 'Buyer' },
  };
  const r = await sendTelegram(
    p,
    { ...defaults, telegramBotToken: '123:private', telegramChatId: '42' },
    {
      fetcher: async (_u, o) => {
        body = JSON.parse(o.body);
        return Response.json({ ok: true, result: { message_id: 8 } });
      },
    },
  );
  assert.equal(body.parse_mode, 'HTML');
  assert(body.text.includes('&lt;script&gt;'));
  assert(!body.text.includes('<script>'));
  assert.equal(body.chat_id, '42');
  assert.equal(body.reply_markup.inline_keyboard[0][0].url, p.url);
  assert.deepEqual(r, { messageId: 8 });
  await assert.rejects(
    sendTelegram({ ...p, url: 'https://evil.example' }, defaults),
    (e) => e.code === 'invalid_post_url',
  );
});

test('Telegram notification language controls labels and inline button', async () => {
  for (const [locale, label] of [
    ['ru', 'Открыть'],
    ['en', 'Open'],
  ]) {
    let body;
    await sendTelegram(
      {
        title: 'Test',
        source: 'reddit',
        url: 'https://www.reddit.com/r/forhire/',
        author: 'test',
        createdAt: Date.now(),
        rules: { score: 80, reason: 'Buyer: looking for; services: website' },
      },
      {
        ...defaults,
        notificationLocale: locale,
        telegramBotToken: '123:fake',
        telegramChatId: '42',
      },
      {
        fetcher: async (_u, o) => {
          body = JSON.parse(o.body);
          return Response.json({ ok: true, result: { message_id: 1 } });
        },
      },
    );
    assert.equal(body.reply_markup.inline_keyboard[0][0].text, label);
    assert.match(body.text, locale === 'ru' ? /Правила:<\/b>/ : /Rules:<\/b>/);
  }
});
