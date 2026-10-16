import { statusLabel, messageFor } from './localization.mjs';
import { json } from './net.mjs';
import { SourceError } from './errors.mjs';
import { canonicalUrl } from './connectors.mjs';
const escape = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
const clip = (value, limit) => {
  const chars = Array.from(String(value ?? ''));
  return chars.length > limit ? chars.slice(0, limit - 1).join('') + '…' : chars.join('');
};
export function formatLeadMessage(lead, s, { test = false } = {}) {
  const locale = s.notificationLocale || 'ru';
  if (test)
    return `<b>Delta Leads</b>\n\n${locale === 'ru' ? 'Соединение с Telegram работает.' : 'Telegram connection works.'}`;
  let published;
  try {
    published = new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: s.notificationTimezone || 'UTC',
      hour12: false,
    }).format(new Date(lead.createdAt));
  } catch {
    published = '—';
  }
  const author = String(lead.author || '').replace(/^\/?u\//, '');
  const meta = [
    lead.source,
    author ? (lead.source === 'reddit' ? 'u/' : '@') + author : '',
    `${published} · ${s.notificationTimezone || 'UTC'}`,
  ].filter(Boolean);
  const verdict = lead.ai
    ? `<b>${locale === 'ru' ? 'Нейросеть' : 'AI'}:</b> ${escape(statusLabel(lead.ai.verdict, locale))} · ${Math.round(lead.ai.confidence * 100)}%\n${escape(clip(lead.ai.reason, 400))}`
    : `<b>${locale === 'ru' ? 'Правила' : 'Rules'}:</b> ${lead.rules?.score ?? 0}/100\n${escape(clip(messageFor(lead.rules?.reason || '', locale), 400))}`;
  // Truncate untrusted text BEFORE escaping; never cut an HTML tag/entity or a surrogate pair.
  const excerpt = clip(
    String(lead.text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    650,
  );
  return [
    `🎯 <b>${escape(clip(lead.title, 220))}</b>`,
    escape(meta.join('\n')),
    excerpt ? `<blockquote>${escape(excerpt)}</blockquote>` : '',
    verdict,
  ]
    .filter(Boolean)
    .join('\n\n');
}
export const isTelegramConnectionError = (code) =>
  /^(?:http|telegram)_(?:401|403|404)$/.test(code) || code === 'telegram_chat_not_found';
export async function sendTelegram(lead, s, { fetcher = fetch, test = false } = {}) {
  const url = canonicalUrl(lead.source, lead.url);
  if (!url && !test) throw new SourceError('invalid_post_url', { permanent: true });
  const locale = s.notificationLocale || 'ru';
  let httpStatus = 0,
    headerRetryAfter = 0;
  const result = await json('https://api.telegram.org/bot' + s.telegramBotToken + '/sendMessage', {
    fetcher,
    allowHttpError: true,
    onResponse: (response) => {
      httpStatus = response.status;
      const raw = response.headers.get('retry-after');
      headerRetryAfter = Math.min(
        86400000,
        /^\d+$/.test(raw || '')
          ? Number(raw) * 1000
          : Math.max(0, Date.parse(raw) - Date.now()) || 0,
      );
    },
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: s.telegramChatId,
      text: formatLeadMessage(lead, s, { test }),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(!test
        ? {
            reply_markup: {
              inline_keyboard: [[{ text: locale === 'ru' ? 'Открыть' : 'Open', url }]],
            },
          }
        : {}),
    }),
  }).catch((e) => {
    if (httpStatus >= 400 && e.code === 'invalid_json')
      throw new SourceError('http_' + httpStatus, {
        retryAfter: headerRetryAfter,
        permanent: [400, 401, 403, 404].includes(httpStatus),
      });
    throw e;
  });
  if (!result.ok)
    throw new SourceError(
      result.error_code === 400 && /chat not found/i.test(result.description || '')
        ? 'telegram_chat_not_found'
        : 'telegram_' + (result.error_code || 'failed'),
      {
        retryAfter: Math.min(
          86400000,
          Math.max(headerRetryAfter, Number(result.parameters?.retry_after || 0) * 1000),
        ),
        permanent: [400, 401, 403, 404].includes(result.error_code),
      },
    );
  return { messageId: result.result?.message_id };
}
