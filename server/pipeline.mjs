import { statusLabel, messageFor } from './localization.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Store, atomicJson } from './state.mjs';
import { defaults, parseSettings, publicSettings, lines } from './settings.mjs';
import { classify, analyze, textOf } from './classifier.mjs';
import { createConnectors, normalize } from './connectors.mjs';
import { sendTelegram } from './telegram.mjs';
import { DeltaError, safeError } from './errors.mjs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export class Pipeline {
  constructor(
    dir,
    {
      connectors = createConnectors(),
      ai = analyze,
      telegram = sendTelegram,
      now = Date.now,
      sleep = wait,
    } = {},
  ) {
    this.store = new Store(dir);
    this.dir = dir;
    this.settings = { ...defaults };
    this.connectors = connectors;
    this.ai = ai;
    this.telegram = telegram;
    this.now = now;
    this.sleep = sleep;
    this.running = false;
    this.lastError = null;
    this.configTail = Promise.resolve();
    this.timer = null;
    this.stopped = false;
  }
  async init() {
    await this.store.load();
    try {
      this.settings = parseSettings(
        JSON.parse(await readFile(join(this.dir, 'settings.json'), 'utf8')),
      );
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    return this;
  }
  async configure(values) {
    const task = this.configTail.then(async () => {
      const next = parseSettings(values, this.settings);
      await atomicJson(join(this.dir, 'settings.json'), next);
      this.settings = next;
      return publicSettings(next);
    });
    this.configTail = task.catch(() => {});
    return task;
  }
  status() {
    const d = this.store.data;
    return {
      settings: publicSettings(this.settings),
      running: this.running,
      lastScanAt: d.lastScanAt,
      lastError: this.lastError,
      totals: d.totals,
      sources: d.sources,
      notices: [
        ...(this.lastError
          ? [
              {
                id: 'leads.scan',
                severity: 'warn',
                message: 'Last scan failed: ' + this.lastError,
                localizations: { ru: 'Последняя проверка завершилась ошибкой: ' + this.lastError },
              },
            ]
          : []),
        ...Object.entries(d.sources)
          .filter(([, v]) => v.error)
          .map(([source, v]) => ({
            id: 'leads.source.' + source,
            severity: 'warn',
            message:
              source + ': ' + v.error + '; next attempt ' + new Date(v.retryAt).toISOString(),
            localizations: {
              ru:
                source +
                ': ' +
                v.error +
                '; следующая попытка ' +
                new Date(v.retryAt).toISOString(),
            },
          })),
        ...(!this.settings.telegramEnabled
          ? [
              {
                id: 'leads.telegram',
                severity: 'info',
                message: 'Telegram is disabled. Web lead notifications remain available.',
                localizations: {
                  ru: 'Telegram отключён. Уведомления о лидах в веб-панели остаются доступны.',
                },
              },
            ]
          : []),
      ],
      activity: {
        eventsPerMin: 0,
        lastSyncAt: d.lastScanAt,
        lastInputAt: d.lastScanAt,
        rateLabel: { ru: 'постов/мин', en: 'posts/min' },
      },
    };
  }
  startScan() {
    if (this.running) return { accepted: false, running: true };
    void this.scan().catch((e) => {
      this.lastError = safeError(e);
    });
    return { accepted: true, running: true };
  }
  async scan() {
    if (this.running) return { skipped: true };
    this.running = true;
    const s = structuredClone(this.settings),
      now = this.now(),
      d = this.store.data;
    const scan = {
      ts: now,
      scanned: 0,
      leads: 0,
      competitors: 0,
      excluded: 0,
      sent: 0,
      aiCalls: 0,
      errors: 0,
    };
    this.lastError = null;
    try {
      for (const [name, connector] of Object.entries(this.connectors)) {
        if (this.stopped || !s[name + 'Enabled']) continue;
        const previous = d.sources[name] || {};
        if (previous.retryAt > now) continue;
        let count = 0,
          partial = false;
        try {
          for (const query of lines(s[name + 'Queries'] || s.queries)) {
            let cursor = null;
            for (let page = 0; page < 3; page++) {
              if (this.stopped) break;
              const result = await connector.search(query, s, { cursor, now });
              if (!Array.isArray(result.posts)) throw new Error('Invalid connector result');
              for (const post of result.posts) {
                if (this.stopped) break;
                count++;
                await this.ingest(post, s, scan, now);
              }
              cursor = result.cursor;
              if (!cursor) break;
              if (page === 2) partial = true;
              await this.sleep(1100);
            }
            if (this.stopped) break;
            await this.sleep(1100);
          }
          d.sources[name] = {
            checkedAt: now,
            count,
            partial,
            error: null,
            retryAt: 0,
            failures: 0,
          };
        } catch (e) {
          const failures = (previous.failures || 0) + 1;
          d.sources[name] = {
            checkedAt: now,
            count,
            partial: true,
            error: safeError(e),
            failures,
            retryAt:
              now +
              Math.max(
                e.retryAfter || 0,
                Math.min(3600000, 60000 * 2 ** Math.min(failures - 1, 6)),
              ),
          };
          scan.errors++;
        }
      }
      for (const post of d.posts
        .filter((p) => p.verdict === 'pending_ai' && p.retryAt <= now)
        .slice(0, s.maxAiPerScan)) {
        if (this.stopped || scan.aiCalls >= s.maxAiPerScan) break;
        const rules = classify(post, s, now);
        post.rules = rules;
        if (rules.verdict !== 'lead') {
          post.verdict = rules.verdict;
          post.reason = rules.reason;
          continue;
        }
        await this.decide(post, s, scan, now);
      }
      await this.deliver(s, scan, now);
      d.lastScanAt = now;
      d.scans.push(scan);
      this.store.trim(s, now);
      await this.store.save();
      return scan;
    } catch (e) {
      this.lastError = safeError(e);
      throw e;
    } finally {
      this.running = false;
    }
  }
  async ingest(raw, s, scan, now) {
    const p = normalize(raw.source, raw);
    if (!p) return; // connectors and future adapters share one validated envelope
    const fingerprint = createHash('sha256')
      .update(
        textOf(p)
          .replace(/https?:\/\/\S+/g, '')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .digest('hex');
    const d = this.store.data;
    if (d.seen[p.id] || d.seen['text:' + fingerprint]) return;
    const rules = classify(p, s, now);
    scan.scanned++;
    d.totals.scanned++;
    d.seen[p.id] = now;
    d.seen['text:' + fingerprint] = now;
    if (rules.verdict === 'stale') {
      scan.excluded++;
      d.totals.excluded++;
      return;
    }
    const post = {
      ...p,
      detectedAt: now,
      rules,
      verdict: rules.verdict,
      reason: rules.reason,
      delivery: { state: 'not_eligible', attempts: 0 },
      review: 'new',
    };
    d.posts.push(post);
    if (rules.verdict === 'lead') await this.decide(post, s, scan, now);
    else if (rules.verdict === 'competitor') {
      scan.competitors++;
      d.totals.competitors++;
    } else {
      scan.excluded++;
      d.totals.excluded++;
    }
  }
  async decide(post, s, scan, now) {
    if (s.aiEnabled) {
      if (scan.aiCalls >= s.maxAiPerScan) {
        post.verdict = 'pending_ai';
        post.reason = 'Waiting for next AI budget';
        post.retryAt = now + 60000;
        return;
      }
      scan.aiCalls++;
      try {
        post.ai = await this.ai(post, post.rules, s);
        post.verdict = post.ai.verdict;
        post.reason = post.ai.reason;
        delete post.retryAt;
      } catch (e) {
        post.verdict = 'pending_ai';
        post.reason = 'AI unavailable: ' + safeError(e);
        post.retryAt = now + Math.max(60000, e.retryAfter || 0);
        scan.errors++;
        return;
      }
    } else {
      post.verdict = post.rules.verdict;
      post.reason = post.rules.reason;
    }
    if (post.verdict === 'lead' && !post.acceptedAt) {
      post.acceptedAt = now;
      post.delivery = {
        state: s.telegramEnabled ? 'pending' : 'disabled',
        attempts: 0,
        nextAt: now,
      };
      scan.leads++;
      this.store.data.totals.leads++;
    } else if (post.verdict === 'competitor') {
      scan.competitors++;
      this.store.data.totals.competitors++;
    }
  }
  async deliver(s, scan, now) {
    if (!s.telegramEnabled) return;
    let attempts = 0;
    for (const p of this.store.data.posts.filter(
      (p) =>
        p.verdict === 'lead' &&
        ['pending', 'retry', 'sending'].includes(p.delivery.state) &&
        (!p.delivery.nextAt || p.delivery.nextAt <= now),
    )) {
      if (this.stopped || attempts >= s.maxTelegramPerScan) break;
      if (now - p.createdAt > s.freshnessHours * 3600000) {
        p.delivery.state = 'expired';
        continue;
      }
      attempts++;
      p.delivery = {
        ...p.delivery,
        state: 'sending',
        attempts: p.delivery.attempts + 1,
        lastAttemptAt: now,
      };
      await this.store.save();
      try {
        const result = await this.telegram(p, s);
        p.delivery = { ...p.delivery, state: 'sent', sentAt: this.now(), ...result };
        scan.sent++;
        this.store.data.totals.sent++;
        await this.store.save();
      } catch (e) {
        p.delivery = {
          ...p.delivery,
          state: e.permanent ? 'failed' : 'retry',
          error: safeError(e),
          nextAt:
            now +
            Math.max(
              e.retryAfter || 0,
              Math.min(3600000, 60000 * 2 ** Math.min(p.delivery.attempts - 1, 6)),
            ),
        };
        await this.store.save();
        if (e.retryAfter || e.permanent) break;
      }
      await this.sleep(1100);
    }
  }
  list({ offset = 0, limit = 30, verdict = '', search = '', _locale = 'en' } = {}) {
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      typeof search !== 'string' ||
      search.length > 200
    )
      throw new DeltaError('bad_request', 'Invalid query');
    const rows = this.store.data.posts
      .filter(
        (p) =>
          (!verdict || p.verdict === verdict) &&
          (!search || textOf(p).includes(search.toLowerCase())),
      )
      .sort((a, b) => b.createdAt - a.createdAt);
    return {
      rows: rows.slice(offset, offset + limit).map((p) => ({
        id: p.id,
        title: p.title,
        url: p.url,
        source: p.source,
        createdAt: p.createdAt,
        verdict: p.verdict,
        verdictLabel: statusLabel(p.verdict, _locale),
        score: p.rules.score,
        confidence: p.ai?.confidence ?? null,
        reason: p.ai ? p.reason : messageFor(p.reason, _locale),
        model: p.ai?.model || statusLabel('rules', _locale),
        delivery: p.delivery.state,
        deliveryLabel: statusLabel(p.delivery.state, _locale),
        review: p.review,
        reviewLabel: statusLabel(p.review, _locale),
      })),
      total: rows.length,
    };
  }
  notifications({ _locale = 'en' } = {}) {
    return this.store.data.posts
      .filter((p) => p.verdict === 'lead')
      .sort((a, b) => b.acceptedAt - a.acceptedAt)
      .slice(0, 100)
      .map((p) => ({
        id: p.id,
        ts: p.acceptedAt,
        severity: 'info',
        title: p.title,
        body: p.source + ' · ' + (p.ai ? p.reason : messageFor(p.reason, _locale)),
        read: false,
        link: '/plugins/dev.delta.leads',
      }));
  }
  stats({ _locale = 'en' } = {}) {
    const d = this.store.data;
    return {
      rows: Object.entries(d.totals).map(([metric, value]) => ({
        metric: statusLabel(
          metric === 'sent' ? 'sentCount' : metric === 'excluded' ? 'excludedCount' : metric,
          _locale,
        ),
        value,
      })),
      total: Object.keys(d.totals).length,
    };
  }
  sourceStatus({ _locale = 'en' } = {}) {
    return {
      rows: Object.entries(this.store.data.sources).map(([source, v]) => ({
        source,
        ...v,
        partial: _locale === 'ru' ? (v.partial ? 'Да' : 'Нет') : v.partial ? 'Yes' : 'No',
      })),
      total: Object.keys(this.store.data.sources).length,
    };
  }
  metrics(query, _locale = 'en') {
    const {
      metricId,
      range,
      aggregation = 'sum',
      compare = 'none',
      groupBy,
      filters,
    } = query || {};
    const spans = {
      '15m': 900000,
      '1h': 3600000,
      '6h': 21600000,
      '24h': 86400000,
      '7d': 604800000,
      '30d': 2592000000,
      '90d': 7776000000,
    };
    const to = range?.preset ? this.now() : range?.to;
    const from = range?.preset ? to - spans[range.preset] : range?.from;
    if (
      !['scanned', 'leads', 'competitors', 'excluded', 'sent'].includes(metricId) ||
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      from < 0 ||
      to <= from ||
      to - from > 366 * 86400000 ||
      aggregation !== 'sum' ||
      !['none', 'previous'].includes(compare) ||
      groupBy ||
      Object.values(filters || {}).some((v) => !Array.isArray(v) || v.length)
    )
      throw new DeltaError('bad_request', 'Invalid metric query');
    const step = query.stepMs ?? Math.max(60000, Math.ceil((to - from) / 120 / 60000) * 60000);
    if (!Number.isInteger(step) || step < 1000 || Math.ceil((to - from) / step) > 2000)
      throw new DeltaError('bad_request', 'Invalid metric query');
    const label = statusLabel(
      metricId === 'sent' ? 'sentCount' : metricId === 'excluded' ? 'excludedCount' : metricId,
      _locale,
    );
    const rows = this.store.data.scans;
    const sum = (a, b) =>
      rows.filter((s) => s.ts >= a && s.ts < b).reduce((n, s) => n + (s[metricId] || 0), 0);
    const build = (origin, shift = 0) =>
      Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => ({
        t: origin + i * step + shift,
        v: sum(origin + i * step, Math.min(origin + (i + 1) * step, origin + to - from)),
      }));
    const points = build(from),
      previous = compare === 'previous' ? sum(from - (to - from), from) : null;
    return {
      query,
      from,
      to,
      stepMs: step,
      generatedAt: this.now(),
      series: [{ key: metricId, label, points }],
      ...(compare === 'previous'
        ? {
            compare: [
              {
                key: metricId + '__prev',
                label: label + (_locale === 'ru' ? ' · предыдущий период' : ' · previous period'),
                points: build(from - (to - from), to - from),
              },
            ],
          }
        : {}),
      summary: {
        current: sum(from, to),
        previous,
        min: Math.min(...points.map((p) => p.v)),
        max: Math.max(...points.map((p) => p.v)),
      },
    };
  }
  preview({ text = '', title = '', _locale = 'en' } = {}) {
    if (
      typeof text !== 'string' ||
      typeof title !== 'string' ||
      text.length > 16000 ||
      title.length > 1000
    )
      throw new DeltaError('bad_request', 'Invalid preview');
    const r = classify(
      { title, text, createdAt: this.now(), source: 'reddit', author: 'preview' },
      this.settings,
      this.now(),
    );
    return {
      ...r,
      verdictLabel: statusLabel(r.verdict, _locale),
      reason: messageFor(r.reason, _locale),
    };
  }
  async feedback({ id, review }) {
    if (!['new', 'relevant', 'false_positive', 'contacted', 'won'].includes(review))
      throw new DeltaError('bad_request', 'Invalid review');
    const p = this.store.data.posts.find((p) => p.id === id);
    if (!p) throw new DeltaError('not_found', 'Post not found');
    p.review = review;
    await this.store.save();
    return { id, review };
  }
  start() {
    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      try {
        if (
          this.settings.enabled &&
          !this.running &&
          this.now() - this.store.data.lastScanAt >= this.settings.intervalSec * 1000
        )
          await this.scan();
      } catch (e) {
        this.lastError = safeError(e);
      }
      if (!this.stopped) this.timer = setTimeout(tick, 10000);
    };
    this.timer = setTimeout(tick, 1000);
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    while (this.running) await this.sleep(50);
    await this.store.tail;
  }
}
