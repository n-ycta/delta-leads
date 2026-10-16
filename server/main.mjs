import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pipeline } from './pipeline.mjs';
import { DeltaClient, serve } from './sdk.mjs';
import { sendTelegram } from './telegram.mjs';
import { DeltaError } from './errors.mjs';
const client = new DeltaClient();
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const pipeline = await new Pipeline(
  resolve(process.env.DATA_DIR || process.env.DELTA_DATA || 'data'),
).init();
const controller = new AbortController();
const handlers = {
  'leads.status': () => pipeline.status(),
  'leads.settings': ({ values }) =>
    values === undefined ? pipeline.status().settings : pipeline.configure(values),
  'leads.scan_now': () => pipeline.startScan(),
  'leads.list': (args) => pipeline.list(args),
  'leads.statistics': (args) => pipeline.stats(args),
  'leads.sources': (args) => pipeline.sourceStatus(args),
  'leads.notifications': (args) => pipeline.notifications(args),
  'leads.metrics_query': ({ query, _locale }) => pipeline.metrics(query, _locale),
  'leads.preview': (args) => pipeline.preview(args),
  'leads.feedback': (args) => pipeline.feedback(args),
  'leads.test_telegram': async () => {
    if (!pipeline.settings.telegramBotToken || !pipeline.settings.telegramChatId)
      throw new DeltaError(
        'bad_request',
        'Configure Telegram bot token and recipient chat ID first',
      );
    return sendTelegram({}, pipeline.settings, { test: true });
  },
};
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => controller.abort());
pipeline.start();
try {
  await serve(client, manifest, handlers, controller.signal);
} finally {
  await pipeline.stop();
}
