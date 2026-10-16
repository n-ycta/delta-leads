import { preset } from './preset.mjs';
import { bad } from './errors.mjs';
import { safeEndpoint } from './net.mjs';
export const fields = [];
const add = (group, key, type, label, extra = {}) =>
  fields.push({ group, key, type, label, ...extra });
add('Pipeline', 'enabled', 'boolean', 'Enable scheduled lead search', { default: true });
add('Pipeline', 'intervalSec', 'number', 'Check interval', {
  default: 300,
  min: 60,
  max: 86400,
  step: 1,
  unit: 's',
});
add('Pipeline', 'freshnessHours', 'number', 'Maximum post age', {
  default: 24,
  min: 1,
  max: 168,
  unit: 'h',
});
add('Pipeline', 'retentionDays', 'number', 'Local history retention', {
  default: 30,
  min: 1,
  max: 90,
  unit: 'days',
});
add('Pipeline', 'languages', 'multiselect', 'Languages', {
  default: ['ru', 'en'],
  options: [
    { value: 'ru', label: 'Русский' },
    { value: 'en', label: 'English' },
  ],
});
add('Search rules', 'queries', 'string', 'Search queries (one per line, up to 12)', {
  default: preset.queries.join('\n'),
  multiline: true,
});
add('Search rules', 'services', 'string', 'Services / topic keywords (one per line)', {
  default: preset.services.join('\n'),
  multiline: true,
});
add('Search rules', 'buyerTerms', 'string', 'Buyer-intent phrases (one per line)', {
  default: preset.buyer.join('\n'),
  multiline: true,
});
add('Search rules', 'sellerTerms', 'string', 'Seller / competitor phrases (one per line)', {
  default: preset.seller.join('\n'),
  multiline: true,
});
add('Search rules', 'excludedTerms', 'string', 'Exclusion phrases (one per line)', {
  default: preset.excluded.join('\n'),
  multiline: true,
});
add('Search rules', 'minScore', 'number', 'Minimum rule score', {
  default: 75,
  min: 50,
  max: 100,
  step: 1,
});
add(
  'Search rules',
  'blockedAuthors',
  'string',
  'Blocked authors (one per line, source:username or username)',
  { default: '', multiline: true },
);
add('Reddit', 'redditEnabled', 'boolean', 'Search Reddit', { default: true });
add('Reddit', 'redditMode', 'select', 'Reddit access method', {
  default: 'rss',
  options: [
    { value: 'rss', label: 'Public RSS / Atom' },
    { value: 'json', label: 'Public JSON' },
    { value: 'oauth', label: 'OAuth API' },
  ],
});
add('Reddit', 'subreddits', 'string', 'Subreddits (comma separated; empty = all Reddit)', {
  default: 'forhire,slavelabour,freelance_forhire,Entrepreneur,smallbusiness',
});
add('Reddit', 'redditClientId', 'string', 'Reddit OAuth client ID', { default: '' });
for (const [key, label] of [
  ['redditClientSecret', 'Reddit OAuth client secret'],
  ['redditRefreshToken', 'Reddit OAuth refresh token (optional)'],
])
  add('Reddit', key, 'secret', label);
add('Reddit', 'redditUserAgent', 'string', 'Reddit descriptive user agent', {
  default: 'delta-leads/0.1.0 (personal lead research; configure contact)',
  help: 'Set a descriptive user agent identifying your app and contact. Reddit can require approved API access.',
});
add('X', 'xQueries', 'string', 'X search queries (one per line; empty uses shared queries)', {
  default: '',
  multiline: true,
});
add('X', 'xEnabled', 'boolean', 'Search X (requires API access)', { default: false });
add('X', 'xBearerToken', 'secret', 'X API bearer token');
add('Threads', 'threadsQueries', 'string', 'Threads keyword queries (one phrase per line)', {
  default:
    'need a website\nlooking for developer\nautomation help\ntelegram bot\nнужен сайт\nищу разработчика\nнужен бот\nавтоматизация',
  multiline: true,
});
add(
  'Threads',
  'threadsEnabled',
  'boolean',
  'Search Threads (requires approved keyword-search permission)',
  { default: false },
);
add('Threads', 'threadsAccessToken', 'secret', 'Threads user access token');
add('AI verdict', 'aiEnabled', 'boolean', 'Analyze candidates with an AI model before notifying', {
  default: false,
  help: 'Public post text is sent to your configured provider. Errors and uncertain verdicts are held, never sent as leads.',
});
add('AI verdict', 'aiBaseUrl', 'string', 'OpenAI-compatible API base URL', {
  default: 'https://api.openai.com/v1',
  help: 'HTTPS, or HTTP on localhost for a local model. Example: http://127.0.0.1:11434/v1',
});
add('AI verdict', 'aiApiKey', 'secret', 'Model API key (optional for local models)');
add('AI verdict', 'aiModel', 'string', 'Model name', { default: 'gpt-4.1-mini' });
add('AI verdict', 'aiMinConfidence', 'number', 'Minimum AI confidence', {
  default: 0.85,
  min: 0.5,
  max: 1,
  step: 0.01,
});
add('AI verdict', 'profile', 'string', 'Your services / ideal customer', {
  default: preset.profile,
  multiline: true,
});
add('AI verdict', 'maxAiPerScan', 'number', 'Maximum AI calls per scan', {
  default: 20,
  min: 1,
  max: 100,
  step: 1,
});
add('Notifications', 'notificationLocale', 'select', 'Telegram message language', {
  default: 'ru',
  options: [
    { value: 'ru', label: 'Русский' },
    { value: 'en', label: 'English' },
  ],
});
add('Notifications', 'telegramEnabled', 'boolean', 'Send leads to Telegram', { default: false });
add('Notifications', 'telegramBotToken', 'secret', 'Telegram bot token');
add('Notifications', 'telegramChatId', 'string', 'Telegram recipient chat ID', {
  default: '',
  help: 'Your chat or group ID. Open the bot and press Start first. This is the recipient, not the sender ID.',
});
add('Notifications', 'maxTelegramPerScan', 'number', 'Maximum Telegram sends per scan', {
  default: 10,
  min: 1,
  max: 50,
  step: 1,
});
export const secrets = fields.filter((f) => f.type === 'secret').map((f) => f.key);
export const defaults = Object.fromEntries(fields.map((f) => [f.key, f.default ?? '']));
export const lines = (v) =>
  String(v)
    .split(/[\r\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
export function parseSettings(values, current = defaults) {
  if (!values || typeof values !== 'object' || Array.isArray(values))
    bad('Expected settings object');
  const next = { ...current };
  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith('_')) continue;
    const f = fields.find((f) => f.key === key);
    if (!f) bad('Unknown setting: ' + key);
    if (
      ['string', 'secret', 'select'].includes(f.type) &&
      (typeof value !== 'string' || value.length > 16000)
    )
      bad('Invalid ' + key);
    if (f.type === 'boolean' && typeof value !== 'boolean') bad('Invalid ' + key);
    if (
      f.type === 'number' &&
      (!Number.isFinite(value) ||
        value < f.min ||
        value > f.max ||
        (f.step === 1 && !Number.isInteger(value)))
    )
      bad('Invalid ' + key);
    if (f.type === 'select' && !f.options.some((o) => o.value === value)) bad('Invalid ' + key);
    if (
      f.type === 'multiselect' &&
      (!Array.isArray(value) ||
        !value.length ||
        value.some((v) => !f.options.some((o) => o.value === v)))
    )
      bad('Invalid ' + key);
    next[key] = value;
  }
  if (
    !lines(next.queries).length ||
    lines(next.queries).length > 12 ||
    lines(next.queries).some((x) => x.length > 512)
  )
    bad('Use 1–12 queries, each at most 512 characters');
  for (const key of ['xQueries', 'threadsQueries'])
    if (lines(next[key]).length > 12 || lines(next[key]).some((x) => x.length > 512))
      bad('Use at most 12 source queries, each at most 512 characters');
  if (!lines(next.services).length || !lines(next.buyerTerms).length)
    bad('Service and buyer-intent terms must not be empty');
  if (next.subreddits && !next.subreddits.split(',').every((s) => /^[\w]{2,50}$/.test(s.trim())))
    bad('Invalid subreddit names');
  if (next.telegramChatId && !/^-?\d{1,20}$/.test(next.telegramChatId))
    bad('Telegram chat ID must be numeric');
  if (next.telegramBotToken && !/^\d+:[A-Za-z0-9_-]+$/.test(next.telegramBotToken))
    bad('Invalid Telegram bot token');
  if (next.aiEnabled) {
    try {
      safeEndpoint(next.aiBaseUrl);
    } catch {
      bad('Use HTTPS AI endpoint, or HTTP localhost');
    }
    if (!next.aiModel.trim()) bad('Model name is required');
  }
  if (
    next.redditEnabled &&
    next.redditMode === 'oauth' &&
    (!next.redditClientId || !next.redditClientSecret)
  )
    bad('Reddit OAuth client ID and secret are required');
  if (next.xEnabled && !next.xBearerToken) bad('X bearer token required');
  if (next.threadsEnabled && !next.threadsAccessToken) bad('Threads access token required');
  if (next.telegramEnabled && (!next.telegramBotToken || !next.telegramChatId))
    bad('Telegram bot token and recipient chat ID required');
  return next;
}
export const publicSettings = (s) => ({
  ...Object.fromEntries(Object.entries(s).filter(([key]) => !secrets.includes(key))),
  _configuredSecrets: secrets.filter((key) => !!s[key]),
});
