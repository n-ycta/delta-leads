import { analyze } from './classifier.mjs';
import { json } from './net.mjs';
import { DeltaError, safeError } from './errors.mjs';
export async function validateAI(s, options = {}) {
  const post = {
    id: 'diagnostic:ai',
    title: '[Hiring] Need a website and Telegram bot. Budget $500',
    text: 'Looking for a developer for a paid fixed-price project.',
    source: 'reddit',
    author: 'diagnostic',
  };
  const result = await analyze(
    post,
    { score: 100 },
    { ...s, aiTimeoutSec: Math.min(25, s.aiTimeoutSec || 25) },
    options,
  );
  return {
    ok: true,
    model: s.aiModel,
    verdict: result.verdict,
    confidence: result.confidence,
    reason: result.reason,
  };
}
export async function validateTelegram(s, { fetcher = fetch } = {}) {
  if (!s.telegramBotToken || !s.telegramChatId)
    throw new DeltaError('bad_request', 'Configure Telegram bot token and recipient chat ID first');
  const call = async (method, args = {}) => {
    const r = await json('https://api.telegram.org/bot' + s.telegramBotToken + '/' + method, {
      fetcher,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new DeltaError('bad_request', 'Telegram ' + (r.error_code || 'failed'));
    return r.result;
  };
  const bot = await call('getMe');
  const chat = await call('getChat', { chat_id: s.telegramChatId });
  return {
    ok: true,
    bot: bot.username,
    chatId: String(chat.id),
    chatType: chat.type,
    note: 'Credentials and chat access verified. Use Send for a delivery test.',
  };
}

export function diagnosticMessage(code, locale = 'en') {
  const messages = {
    http_400: [
      'Provider rejected request. Check model name and JSON mode.',
      'Провайдер отклонил запрос. Проверьте модель и режим JSON.',
    ],
    http_401: [
      'Authentication failed. Check the API key or bot token.',
      'Авторизация не удалась. Проверьте API-ключ или токен бота.',
    ],
    http_403: [
      'Access denied. Check provider/account permissions.',
      'Доступ запрещён. Проверьте разрешения аккаунта.',
    ],
    http_404: [
      'Endpoint or model not found. Check the base URL and model.',
      'Endpoint или модель не найдены. Проверьте базовый URL и модель.',
    ],
    http_429: [
      'Rate limit reached. Wait before retrying.',
      'Лимит запросов. Дождитесь повторной попытки.',
    ],
    network_error: [
      'Connection failed or timed out. Check endpoint reachability from the plugin host.',
      'Ошибка соединения или таймаут. Проверьте доступность endpoint с компьютера, где запущен плагин.',
    ],
    ai_invalid_output: [
      'Provider returned invalid verdict JSON. Check model compatibility.',
      'Провайдер вернул некорректный JSON-вердикт. Проверьте совместимость модели.',
    ],
  };
  return messages[code]?.[locale === 'ru' ? 1 : 0] || code;
}
