import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLeadMessage, sendTelegram } from '../server/telegram.mjs';
import { normalize } from '../server/connectors.mjs';
import { defaults, parseSettings } from '../server/settings.mjs';
const lead = {
  source: 'reddit',
  id: 'reddit:format',
  url: 'https://www.reddit.com/r/forhire/',
  title: 'Need <website> & bot',
  author: '/u/client',
  createdAt: Date.parse('2026-10-15T21:24:00Z'),
  text: 'First paragraph.\n\nSecond paragraph <b>untrusted</b>.',
  rules: { score: 90, reason: 'Buyer: need; services: website' },
};
test('HTML message preserves paragraphs, escapes every untrusted section and formats an explicit timezone', () => {
  const text = formatLeadMessage(lead, { ...defaults, notificationTimezone: 'Asia/Yekaterinburg' });
  assert(text.includes('<b>Need &lt;website&gt; &amp; bot</b>'));
  assert(
    text.includes(
      '<blockquote>First paragraph.\n\nSecond paragraph &lt;b&gt;untrusted&lt;/b&gt;.</blockquote>',
    ),
  );
  assert(text.includes('02:24'));
  assert(text.includes('Asia/Yekaterinburg'));
  assert(!text.includes('T21:24:00'));
  assert(text.includes('u/client'));
  assert(!text.includes('/u//u/'));
});
test('long hostile Unicode content is truncated before escaping, keeping valid HTML', () => {
  const text = formatLeadMessage(
    { ...lead, title: '🎯<&>'.repeat(1000), text: '<>&🎯'.repeat(5000) },
    defaults,
  );
  assert(text.endsWith('website'));
  assert.equal((text.match(/<blockquote>/g) || []).length, 1);
  assert.equal((text.match(/<\/blockquote>/g) || []).length, 1);
  assert(!text.includes('\uFFFD'));
  assert.throws(() => parseSettings({ notificationTimezone: 'Bad/Timezone' }));
});
test('normalization retains Reddit plaintext and RSS paragraph breaks', () => {
  const plain = normalize('reddit', lead);
  assert(plain.text.includes('\n\n'));
  const rss = normalize('reddit', { ...lead, text: '<p>One</p><p>Two<br/>Three</p>' });
  assert(rss.text.includes('One\n\nTwo\nThree'));
});

test('Telegram HTTP 429 JSON retry_after is retained even without a Retry-After header', async () => {
  await assert.rejects(
    sendTelegram(
      lead,
      { ...defaults, telegramBotToken: '123:test', telegramChatId: '42' },
      {
        fetcher: async () =>
          Response.json(
            { ok: false, error_code: 429, parameters: { retry_after: 321 } },
            { status: 429 },
          ),
      },
    ),
    (e) => e.code === 'telegram_429' && e.retryAfter === 321000,
  );
});

test('Telegram retains Retry-After headers and non-JSON authentication errors', async () => {
  for (const [response, code, retryAfter] of [
    [
      Response.json(
        { ok: false, error_code: 429 },
        { status: 429, headers: { 'retry-after': '22' } },
      ),
      'telegram_429',
      22000,
    ],
    [new Response('unauthorized', { status: 401 }), 'http_401', 0],
    [
      new Response('rate limited', { status: 429, headers: { 'retry-after': '30' } }),
      'http_429',
      30000,
    ],
  ])
    await assert.rejects(
      sendTelegram(
        lead,
        { ...defaults, telegramBotToken: '123:test', telegramChatId: '42' },
        { fetcher: async () => response },
      ),
      (e) => e.code === code && e.retryAfter === retryAfter,
    );
});
