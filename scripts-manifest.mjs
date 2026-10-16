import { ruLocalization } from './server/localization.mjs';
import { fields } from './server/settings.mjs';
import { preset } from './server/preset.mjs';
import { writeFile } from 'node:fs/promises';
const filters = [
  {
    key: 'verdict',
    label: 'Verdict',
    type: 'select',
    default: '',
    options: ['', 'lead', 'pending_ai', 'uncertain', 'competitor', 'irrelevant', 'excluded'].map(
      (value) => ({ value, label: value || 'All' }),
    ),
  },
  { key: 'search', label: 'Search title / text', type: 'string', default: '' },
];
const cols = (list) =>
  list.map(([key, label, type = 'text', urlKey]) => ({
    key,
    label,
    type,
    ...({ title: 300, reason: 320, score: 100, confidence: 120 }[key]
      ? { width: { title: 300, reason: 320, score: 100, confidence: 120 }[key] }
      : {}),
    ...(urlKey ? { urlKey } : {}),
  }));
const actions = [
  {
    id: 'scan_now',
    label: 'Check now',
    description: 'Start one background scan; inspect Sources for progress and errors.',
  },
  {
    id: 'test_telegram',
    label: 'Test Telegram',
    description: 'Send a single test message to the configured recipient.',
  },
  {
    id: 'preview',
    label: 'Test matching rules',
    inputs: [
      { key: 'title', label: 'Post title', type: 'string', default: '' },
      { key: 'text', label: 'Post text', type: 'string', multiline: true, default: '' },
    ],
  },
  {
    id: 'feedback',
    label: 'Review a lead',
    inputs: [
      { key: 'id', label: 'Post ID (source:id)', type: 'string', default: '' },
      {
        key: 'review',
        label: 'Your review',
        type: 'select',
        default: 'relevant',
        options: ['new', 'relevant', 'false_positive', 'contacted', 'won'].map((value) => ({
          value,
          label: value,
        })),
      },
    ],
  },
];
const ui = {
  id: 'dev.delta.leads',
  name: 'Delta Leads',
  version: '0.1.0',
  contract: '^1.5.0',
  publisher: 'n-ycta',
  description:
    'Personal RU/EN lead discovery: Reddit RSS/JSON/OAuth, optional X/Threads APIs, precise buyer rules, AI verdicts and Telegram + web notifications. Generic declarative views require Delta Web 0.6.0+.',
  icon: 'radar',
  category: 'productivity',
  homepage: 'https://github.com/n-ycta/delta-leads',
  repository: 'https://github.com/n-ycta/delta-leads',
  runtime: { targets: ['desktop', 'vps', 'container'] },
  endpoints: {
    status: 'leads.status',
    settings: 'leads.settings',
    notifications: 'leads.notifications',
  },
  capabilities: ['metrics.timeseries', 'actions', 'settings.live', 'settings.read', 'status.read'],
  permissions: [
    {
      scope: 'admin:leads.*',
      reason: 'Read private lead content, manage source credentials and trigger scans.',
    },
  ],
  settings: fields,
  actions,
  views: [
    {
      id: 'posts',
      label: 'Posts & verdicts',
      capability: 'leads.list',
      inputs: filters,
      refreshSec: 30,
      columns: cols([
        ['id', 'ID'],
        ['title', 'Post', 'link', 'url'],
        ['source', 'Source'],
        ['createdAt', 'Published', 'datetime'],
        ['verdictLabel', 'Verdict', 'badge'],
        ['score', 'Rules', 'number'],
        ['confidence', 'AI confidence', 'number'],
        ['reason', 'Reason'],
        ['model', 'Model'],
        ['deliveryLabel', 'Telegram'],
        ['reviewLabel', 'Review'],
      ]),
    },
    {
      id: 'statistics',
      label: 'Lifetime counters',
      capability: 'leads.statistics',
      columns: cols([
        ['metric', 'Metric'],
        ['value', 'Count', 'number'],
      ]),
    },
    {
      id: 'sources',
      label: 'Source health & coverage',
      capability: 'leads.sources',
      refreshSec: 15,
      columns: cols([
        ['source', 'Source'],
        ['checkedAt', 'Last check', 'datetime'],
        ['count', 'Fetched', 'number'],
        ['partial', 'Partial coverage'],
        ['error', 'Error'],
        ['retryAt', 'Retry at', 'datetime'],
      ]),
    },
  ],
  metrics: ['scanned', 'leads', 'competitors', 'excluded', 'sent'].map((id) => ({
    id,
    label: {
      scanned: 'Unique posts checked',
      leads: 'Accepted leads',
      competitors: 'Competitors rejected',
      excluded: 'Posts excluded',
      sent: 'Telegram sent',
    }[id],
    kind: 'counter',
    unit: 'posts',
    precision: 0,
    aggregations: ['sum'],
    defaultAggregation: 'sum',
    dimensions: [],
    visualizations: ['stat', 'timeseries', 'bar'],
    queryCapability: 'leads.metrics_query',
  })),
};
ui.localizations = { ru: ruLocalization(ui) };
const names = [
  'status',
  'settings',
  'scan_now',
  'list',
  'statistics',
  'sources',
  'notifications',
  'metrics_query',
  'preview',
  'feedback',
  'test_telegram',
];
const manifest = {
  id: 'leads',
  version: '0.1.0',
  description: ui.description,
  metadata: { ui },
  capabilities: names.map((name) => ({
    name,
    description: actions.find((a) => a.id === name)?.description || name.replaceAll('_', ' '),
    admin: true,
    params: {},
  })),
};
await writeFile(
  new URL('./manifest.json', import.meta.url),
  JSON.stringify(manifest, null, 2) + '\n',
);
await writeFile(
  new URL('./presets/ru-en-freelance.json', import.meta.url),
  JSON.stringify(preset, null, 2) + '\n',
);
