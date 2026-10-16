import { statusLabel, messageFor } from './localization.mjs';
import { json } from './net.mjs';
import { SourceError } from './errors.mjs';
import { canonicalUrl } from './connectors.mjs';
export async function sendTelegram(lead, s, { fetcher = fetch, test = false } = {}) {
  const url = canonicalUrl(lead.source, lead.url);
  if (!url && !test) throw new SourceError('invalid_post_url', { permanent: true });
  const locale = s.notificationLocale || 'ru';
  const verdict = lead.ai
    ? `${locale === 'ru' ? 'Нейросеть' : 'AI'}: ${statusLabel(lead.ai.verdict, locale)} (${Math.round(lead.ai.confidence * 100)}%) — ${lead.ai.reason}`
    : `${locale === 'ru' ? 'Правила' : 'Rules'}: ${lead.rules?.score ?? 0}/100 — ${messageFor(lead.rules?.reason || '', locale)}`;
  const text = test
    ? locale === 'ru'
      ? 'Delta Leads: соединение с Telegram работает.'
      : 'Delta Leads: Telegram connection works.'
    : [
        `🎯 ${lead.title}`,
        `${lead.source} · ${lead.author} · ${new Date(lead.createdAt).toISOString()}`,
        lead.text?.slice(0, 1000),
        verdict,
      ]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 3900);
  const result = await json('https://api.telegram.org/bot' + s.telegramBotToken + '/sendMessage', {
    fetcher,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: s.telegramChatId,
      text,
      link_preview_options: { is_disabled: true },
      ...(!test
        ? {
            reply_markup: {
              inline_keyboard: [[{ text: locale === 'ru' ? 'Открыть пост' : 'Open post', url }]],
            },
          }
        : {}),
    }),
  });
  if (!result.ok)
    throw new SourceError('telegram_' + (result.error_code || 'failed'), {
      retryAfter: Math.min(86400000, Number(result.parameters?.retry_after || 0) * 1000),
      permanent: [400, 401, 403, 404].includes(result.error_code),
    });
  return { messageId: result.result?.message_id };
}
