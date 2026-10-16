import { preset } from './preset.mjs';
export const profiles = [
  {
    id: 'automation',
    label: 'AI automation',
    ru: 'AI-автоматизация',
    values: {
      services:
        'automation\nautomate\nworkflow\nintegration\nAI agent\nавтоматизац\nинтеграц\nнейросет',
      queries:
        '"looking for" (automation OR workflow OR "AI agent")\n"нужна автоматизация"\n"ищу" (автоматизация OR интеграция)',
      profile:
        'Find buyers seeking paid business automation, AI agents, CRM integrations, lead routing and workflow implementation. Exclude people selling these services.',
    },
  },
  {
    id: 'web',
    label: 'Websites & landing pages',
    ru: 'Сайты и лендинги',
    values: {
      services: 'website\nlanding page\nweb app\nсайт\nлендинг\nвеб-приложен',
      queries: '"[Hiring]" (website OR "landing page")\n"нужен сайт"\n"заказать лендинг"',
      profile:
        'Find buyers seeking paid websites, landing pages, web applications and redesigns. Exclude web developers advertising services, portfolio posts and full-time vacancies.',
    },
  },
  {
    id: 'bots',
    label: 'Bots & scripts',
    ru: 'Боты и скрипты',
    values: {
      services: 'bot\nscript\nscraper\ntelegram\nбот\nскрипт\nпарсер',
      queries: '"[Hiring]" (bot OR script OR scraper)\n"нужен бот"\n"нужен скрипт"',
      profile:
        'Find buyers commissioning paid bots, Telegram integrations, scripts, data processing and lawful scraping tools. Exclude bot vendors, tutorials, spam and requests to bypass access restrictions.',
    },
  },
  {
    id: 'art',
    label: 'Illustration & design',
    ru: 'Иллюстрация и дизайн',
    values: {
      services:
        'illustration\nillustrator\ncommission\ncharacter design\nconcept art\nиллюстрац\nхудожник\nдизайн персонаж',
      queries: '"[Hiring]" (illustrator OR artist)\n"ищу художника"\n"заказать иллюстрацию"',
      profile:
        'Find paying clients commissioning illustrations, character design, concept art or commercial artwork. Exclude artists selling commissions, portfolio showcases, unpaid requests and contests.',
    },
  },
];
export function mergeProfiles(ids) {
  const selected = profiles.filter((p) => ids.includes(p.id));
  const merge = (key) =>
    [...new Set(selected.flatMap((p) => p.values[key].split('\n')).filter(Boolean))].join('\n');
  return {
    services: merge('services'),
    queries: merge('queries'),
    profile: selected.map((p) => p.values.profile).join('\n\n'),
    buyerTerms: preset.buyer.join('\n'),
    sellerTerms: preset.seller.join('\n'),
    excludedTerms: preset.excluded.join('\n'),
  };
}
