const labels = {
  activeProfiles: 'Выбранные профили',
  requestDelaySec: 'Пауза между запросами источников',
  aiMode: 'Режим обработки',
  aiConcurrency: 'Параллельных запросов',
  aiBatchSize: 'Постов в JSON-пакете',
  aiTimeoutSec: 'Таймаут запроса AI',
  aiJsonMode: 'Параметр JSON response_format — отключите, если провайдер не поддерживает',

  notificationLocale: 'Язык сообщений Telegram',
  enabled: 'Фоновый поиск включён',
  intervalSec: 'Интервал проверки',
  freshnessHours: 'Максимальный возраст поста',
  retentionDays: 'Хранение локальной истории',
  languages: 'Языки',
  queries: 'Поисковые запросы — по одному на строку, максимум 12',
  services: 'Услуги и ключевые слова',
  buyerTerms: 'Фразы намерения заказать',
  sellerTerms: 'Фразы исполнителей и конкурентов',
  excludedTerms: 'Исключающие фразы',
  minScore: 'Минимальная оценка правил',
  blockedAuthors: 'Заблокированные авторы',
  redditEnabled: 'Искать в Reddit',
  redditMode: 'Способ доступа к Reddit',
  subreddits: 'Сабреддиты через запятую; пусто — весь Reddit',
  redditClientId: 'Client ID приложения Reddit',
  redditClientSecret: 'Client secret приложения Reddit',
  redditRefreshToken: 'Refresh token Reddit — необязательно',
  redditUserAgent: 'User-Agent Reddit — укажите приложение и контакт',
  xQueries: 'Запросы X; пусто — общие запросы',
  xEnabled: 'Искать в X — нужен доступ к API',
  xBearerToken: 'Bearer token API X',
  threadsQueries: 'Ключевые фразы Threads — по одной на строку',
  threadsEnabled: 'Искать в Threads — нужен доступ к поисковому API',
  threadsAccessToken: 'Токен пользователя Threads',
  aiEnabled: 'Проверять кандидатов нейросетью до уведомления',
  aiBaseUrl: 'Базовый URL OpenAI-совместимого API',
  aiApiKey: 'API-ключ нейросети — необязательно для локальной',
  aiModel: 'Название модели',
  aiMinConfidence: 'Минимальная уверенность нейросети',
  profile: 'Ваши услуги и портрет заказчика',
  maxAiPerScan: 'Максимум вызовов нейросети за проверку',
  telegramEnabled: 'Отправлять лиды в Telegram',
  telegramBotToken: 'Токен Telegram-бота',
  telegramChatId: 'Chat ID получателя в Telegram',
  maxTelegramPerScan: 'Максимум отправок Telegram за проверку',
};
const groups = {
  Pipeline: 'Конвейер',
  'Search rules': 'Правила поиска',
  'AI verdict': 'Вердикт нейросети',
  Notifications: 'Уведомления',
};
const columns = {
  verdictLabel: 'Вердикт',
  deliveryLabel: 'Telegram',
  reviewLabel: 'Ваша оценка',
  id: 'ID',
  title: 'Пост',
  source: 'Источник',
  createdAt: 'Опубликован',
  verdict: 'Вердикт',
  score: 'Оценка правил',
  confidence: 'Уверенность ИИ',
  reason: 'Причина',
  model: 'Модель',
  delivery: 'Telegram',
  review: 'Ваша оценка',
  metric: 'Показатель',
  value: 'Количество',
  checkedAt: 'Проверен',
  count: 'Получено',
  candidates: 'Совпадений',
  partial: 'Неполный охват',
  error: 'Ошибка',
  retryAt: 'Повторная попытка',
};
export function ruLocalization(ui) {
  return {
    description:
      'Личный поиск заказчиков RU/EN: Reddit RSS/JSON/OAuth, X и Threads через API, точные правила, вердикт нейросети и уведомления в Telegram и Web. Общие таблицы требуют Delta Web 0.6.1+.',
    settingsProfiles: {
      items: ui.settingsProfiles?.items.map((p) => ({
        id: p.id,
        label: {
          automation: 'AI-автоматизация',
          web: 'Сайты и лендинги',
          bots: 'Боты и скрипты',
          art: 'Иллюстрация и дизайн',
        }[p.id],
      })),
    },
    settings: ui.settings.map((f) => ({
      key: f.key,
      label: labels[f.key] || f.label,
      group: groups[f.group] || f.group,
      ...(f.key === 'aiEnabled'
        ? {
            help: 'Текст публичного поста передаётся выбранному провайдеру. При ошибке или неуверенном вердикте лид не отправляется.',
          }
        : {}),
      ...(f.key === 'redditUserAgent'
        ? {
            help: 'Укажите приложение и контакт в User-Agent. Reddit может потребовать одобренный доступ к API.',
          }
        : {}),
      ...(f.key === 'aiBaseUrl'
        ? {
            help: 'HTTPS или HTTP на localhost для локальной модели. Пример: http://127.0.0.1:11434/v1',
          }
        : {}),
      ...(f.options
        ? { options: f.options.map((o) => ({ value: o.value, label: optionRu(o.value, o.label) })) }
        : {}),
      ...(f.unit ? { unit: { s: 'с', h: 'ч', days: 'дней' }[f.unit] || f.unit } : {}),
      ...(f.key === 'telegramChatId'
        ? {
            help: 'ID вашего чата или группы. Сначала нажмите Start у бота. Это получатель, а не отправитель.',
          }
        : {}),
    })),
    actions: ui.actions.map((a) => ({
      id: a.id,
      label: {
        scan_now: 'Проверить',
        validate_ai: 'AI',
        validate_telegram: 'Telegram',
        diagnose: 'Диагностика',
        test_telegram: 'Отправить',
        preview: 'Правила',
        feedback: 'Оценить',
      }[a.id],
      ...(a.description
        ? {
            description:
              {
                validate_ai:
                  'Проверить endpoint, ключ, модель и JSON-ответ на тестовом посте. Используются поля формы без сохранения.',
                validate_telegram: 'Проверить бота и доступ к чату без отправки сообщения.',
                diagnose:
                  'Выборка за сутки: первый запрос и страница каждого источника, без уведомлений. Результаты — в диагностике.',
                scan_now:
                  'Запустить фоновую проверку. Ход работы и ошибки видны в таблице источников.',
                test_telegram: 'Отправить одно тестовое сообщение указанному получателю.',
              }[a.id] || a.description,
          }
        : {}),
      inputs: a.inputs?.map((f) => ({
        key: f.key,
        label:
          {
            title: 'Заголовок поста',
            text: 'Текст поста',
            id: 'ID поста (источник:id)',
            review: 'Ваша оценка',
            ai: 'Проверить AI — один кандидат на источник',
          }[f.key] || f.label,
        ...(f.options
          ? {
              options: f.options.map((o) => ({
                value: o.value,
                label: optionRu(o.value, o.label),
              })),
            }
          : {}),
      })),
    })),
    views: ui.views.map((v) => ({
      id: v.id,
      label: {
        diagnostics: 'Диагностика · выборка за сутки',
        posts: 'Посты и вердикты',
        statistics: 'Счётчики за всё время',
        sources: 'Доступность и охват источников',
      }[v.id],
      inputs: v.inputs?.map((f) => ({
        key: f.key,
        label: f.key === 'verdict' ? 'Вердикт' : 'Поиск по заголовку и тексту',
        ...(f.options
          ? {
              options: f.options.map((o) => ({
                value: o.value,
                label: optionRu(o.value, o.label),
              })),
            }
          : {}),
      })),
      columns: v.columns.map((c) => ({ key: c.key, label: columns[c.key] || c.label })),
    })),
    metrics: ui.metrics.map((m) => ({
      id: m.id,
      label: {
        scanned: 'Проверено уникальных постов',
        leads: 'Принято лидов',
        competitors: 'Отсеяно конкурентов',
        excluded: 'Исключено постов',
        sent: 'Отправлено в Telegram',
      }[m.id],
    })),
  };
}

export const statuses = {
  en: {
    '': 'All',
    lead: 'Lead',
    pending_ai: 'Waiting for AI',
    uncertain: 'Uncertain',
    competitor: 'Competitor',
    irrelevant: 'Irrelevant',
    excluded: 'Excluded',
    stale: 'Too old',
    pending: 'Queued',
    retry: 'Retry scheduled',
    sending: 'Sending',
    sent: 'Sent',
    disabled: 'Disabled',
    not_eligible: 'Not eligible',
    expired: 'Expired',
    failed: 'Failed',
    new: 'New',
    relevant: 'Relevant',
    false_positive: 'False positive',
    contacted: 'Contacted',
    won: 'Won',
    rules: 'Rules only',
    scanned: 'Unique posts checked',
    leads: 'Accepted leads',
    competitors: 'Competitors rejected',
    sentCount: 'Telegram sent',
    excludedCount: 'Posts excluded',
  },
  ru: {
    '': 'Все',
    lead: 'Лид',
    pending_ai: 'Ожидает нейросеть',
    uncertain: 'Неоднозначно',
    competitor: 'Конкурент',
    irrelevant: 'Не подходит',
    excluded: 'Исключён',
    stale: 'Устарел',
    pending: 'В очереди',
    retry: 'Запланирован повтор',
    sending: 'Отправляется',
    sent: 'Отправлено',
    disabled: 'Отключено',
    not_eligible: 'Не требуется',
    expired: 'Истёк срок',
    failed: 'Ошибка',
    new: 'Новый',
    relevant: 'Подходит',
    false_positive: 'Ложное срабатывание',
    contacted: 'Связался',
    won: 'Заказ получен',
    rules: 'Только правила',
    scanned: 'Проверено уникальных постов',
    leads: 'Принято лидов',
    competitors: 'Отсеяно конкурентов',
    sentCount: 'Отправлено в Telegram',
    excludedCount: 'Исключено постов',
  },
};
export const statusLabel = (key, locale = 'en') =>
  statuses[locale === 'ru' ? 'ru' : 'en'][key] ?? key;
const messages = {
  'Expected settings object': 'Ожидается объект настроек',
  'Use 1–12 queries, each at most 512 characters':
    'Укажите 1–12 запросов, каждый не длиннее 512 символов',
  'Use at most 12 source queries, each at most 512 characters':
    'Не больше 12 запросов для источника, каждый до 512 символов',
  'Service and buyer-intent terms must not be empty':
    'Списки услуг и фраз намерения заказать не должны быть пустыми',
  'Invalid subreddit names': 'Некорректные названия сабреддитов',
  'Telegram chat ID must be numeric': 'Chat ID Telegram должен быть числом',
  'Invalid Telegram bot token': 'Некорректный токен Telegram-бота',
  'Use HTTPS AI endpoint, or HTTP localhost':
    'Используйте HTTPS для нейросети или HTTP на localhost',
  'Model name is required': 'Укажите название модели',
  'Reddit OAuth client ID and secret are required':
    'Нужны Client ID и Client secret приложения Reddit',
  'X bearer token required': 'Нужен Bearer token для X',
  'Threads access token required': 'Нужен токен доступа Threads',
  'Telegram bot token and recipient chat ID required':
    'Укажите токен Telegram-бота и chat ID получателя',
  'Configure Telegram bot token and recipient chat ID first':
    'Сначала настройте токен Telegram-бота и chat ID получателя',
  'Invalid query': 'Некорректный запрос',
  'Invalid metric query': 'Некорректный запрос метрики',
  'Invalid preview': 'Некорректный текст для проверки',
  'Invalid review': 'Некорректная оценка',
  'Post not found': 'Пост не найден',
  'Plugin operation failed': 'Операция плагина не выполнена',
  'Unknown capability': 'Неизвестная возможность API',
  'Post outside configured freshness window': 'Пост вне заданного окна свежести',
  'Language not selected': 'Язык не выбран',
  'Blocked author': 'Заблокированный автор',
  'No matching service': 'Услуга не найдена',
  'No explicit buyer intent': 'Нет явного намерения заказать',
  'Waiting for next AI budget': 'Ожидает следующего лимита вызовов нейросети',
};
export function messageFor(text, locale = 'en') {
  if (locale !== 'ru' || !text) return text;
  if (messages[text]) return messages[text];
  for (const [en, ru] of [
    ['Unknown setting: ', 'Неизвестная настройка: '],
    ['Invalid ', 'Некорректное значение: '],
    ['Seller intent: ', 'Признаки исполнителя: '],
    ['Excluded content: ', 'Исключающий контент: '],
    ['Buyer: ', 'Заказчик: '],
    ['AI unavailable: ', 'Нейросеть недоступна: '],
  ])
    if (text.startsWith(en))
      return ru + text.slice(en.length).replace('; services: ', '; услуги: ');
  return text;
}

function optionRu(value, fallback) {
  return (
    {
      automation: 'AI-автоматизация',
      web: 'Сайты и лендинги',
      bots: 'Боты и скрипты',
      art: 'Иллюстрация и дизайн',
      sequential: 'Последовательно',
      parallel: 'Параллельные запросы',
      batch: 'JSON-пакеты',
      ru: 'Русский',
      en: 'Английский',
      rss: 'Публичный RSS / Atom',
      json: 'Публичный JSON',
      oauth: 'OAuth API',
    }[value] ??
    statuses.ru[value] ??
    fallback
  );
}
