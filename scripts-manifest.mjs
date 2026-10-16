import { profiles, mergeProfiles } from './server/profiles.mjs';
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
    label: 'Scan',
    description: 'Start one background scan; inspect Sources for progress and errors.',
  },
  {
    id: 'test_telegram',
    label: 'Send',
    description: 'Send a single test message to the configured recipient.',
  },
  {
    id: 'preview',
    label: 'Preview',
    inputs: [
      { key: 'title', label: 'Post title', type: 'string', default: '' },
      { key: 'text', label: 'Post text', type: 'string', multiline: true, default: '' },
    ],
  },
  {
    id: 'feedback',
    label: 'Review',
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
actions.push(
  {
    id: 'validate_ai',
    label: 'AI',
    settingsAction: true,
    description:
      'Validate endpoint, key, model and actual structured output using current form values without saving.',
  },
  {
    id: 'validate_telegram',
    label: 'Telegram',
    settingsAction: true,
    description: 'Validate bot identity and recipient chat access without sending a message.',
  },
  {
    id: 'diagnose',
    label: 'Diagnose',
    description:
      'Read-only sample from the last 24h (first query/page per source). No notifications. Results appear in Diagnostics.',
    inputs: [
      {
        key: 'ai',
        label: 'Include AI (one candidate per source)',
        type: 'boolean',
        default: false,
      },
    ],
  },
);
const ui = {
  id: 'dev.delta.leads',
  name: 'Delta Leads',
  version: '0.1.4',
  contract: '^1.6.0',
  publisher: 'n-ycta',
  description:
    'Personal RU/EN lead discovery: Reddit RSS/JSON/OAuth, optional X/Threads APIs, precise buyer rules, AI verdicts and Telegram + web notifications. Generic declarative views require Delta Web 0.6.2+.',
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
  settingsProfiles: {
    selectionKey: 'activeProfiles',
    protectedKeys: ['profile'],
    items: profiles.map(({ id, label }) => ({ id, label, values: mergeProfiles([id]) })),
  },
  settings: fields,
  actions,
  views: [
    {
      id: 'leads',
      label: 'New leads',
      capability: 'leads.list',
      refreshSec: 15,
      dashboard: { args: { verdict: 'lead' }, limit: 10 },
      columns: cols([
        ['createdAt', 'Published', 'datetime'],
        ['title', 'Post', 'link', 'url'],
        ['source', 'Source'],
        ['verdictLabel', 'Verdict', 'badge'],
        ['deliveryLabel', 'Telegram'],
        ['confidence', 'AI confidence', 'number'],
        ['reason', 'Reason'],
      ]),
    },
    {
      id: 'diagnostics',
      label: 'Diagnostics · last 24h sample',
      capability: 'leads.diagnostics',
      refreshSec: 5,
      columns: cols([
        ['source', 'Source'],
        ['checkedAt', 'Started', 'datetime'],
        ['count', 'Recent posts', 'number'],
        ['candidates', 'Rule matches', 'number'],
        ['verdict', 'AI verdict'],
        ['reason', 'Reason'],
        ['error', 'Error'],
      ]),
    },
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
  'validate_ai',
  'validate_telegram',
  'diagnose',
  'diagnostics',
  'profiles',
];
const valuesSchema = {
  type: 'object',
  description:
    'Partial settings; omitted secrets remain unchanged. Empty secret explicitly clears it.',
  additionalProperties: false,
  properties: Object.fromEntries(
    fields.map((f) => [
      f.key,
      {
        type:
          f.type === 'secret' || f.type === 'select'
            ? 'string'
            : f.type === 'multiselect'
              ? 'array'
              : f.type,
        ...(f.type === 'multiselect' ? { items: { type: 'string' } } : {}),
        ...(f.min !== undefined ? { minimum: f.min, maximum: f.max } : {}),
        ...(f.options
          ? {
              [f.type === 'multiselect' ? 'items' : 'enum']:
                f.type === 'multiselect'
                  ? { type: 'string', enum: f.options.map((o) => o.value) }
                  : f.options.map((o) => o.value),
            }
          : {}),
      },
    ]),
  ),
};
const params = {
  settings: { values: valuesSchema },
  validate_ai: { values: valuesSchema },
  validate_telegram: { values: valuesSchema },
  list: {
    offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    verdict: { type: 'string' },
    search: { type: 'string' },
  },
  metrics_query: {
    query: {
      type: 'object',
      required: true,
      properties: {
        metricId: { type: 'string' },
        range: { type: 'object' },
        aggregation: { type: 'string' },
        stepMs: { type: 'integer' },
        compare: { type: 'string' },
      },
    },
  },
  preview: { title: { type: 'string' }, text: { type: 'string' } },
  feedback: {
    id: { type: 'string', required: true },
    review: {
      type: 'string',
      required: true,
      enum: ['new', 'relevant', 'false_positive', 'contacted', 'won'],
    },
  },
  diagnose: { ai: { type: 'boolean' } },
  profiles: {
    ids: {
      type: 'array',
      required: true,
      items: { type: 'string', enum: profiles.map((p) => p.id) },
    },
  },
};
const manifest = {
  id: 'leads',
  version: '0.1.4',
  description: ui.description,
  metadata: { ui },
  capabilities: names.map((name) => ({
    name,
    description: actions.find((a) => a.id === name)?.description || name.replaceAll('_', ' '),
    admin: true,
    params: { ...(params[name] || {}), _locale: { type: 'string', enum: ['en', 'ru'] } },
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
