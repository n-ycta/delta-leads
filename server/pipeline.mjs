import { validateAI, validateTelegram, diagnosticMessage } from './diagnostics.mjs';
import { profiles, mergeProfiles } from './profiles.mjs';
import { statusLabel, messageFor } from './localization.mjs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Store, atomicJson } from './state.mjs';
import { defaults, parseSettings, publicSettings, lines } from './settings.mjs';
import { classify, analyze, analyzeBatch, textOf } from './classifier.mjs';
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
      aiBatch = analyzeBatch,
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
    this.aiBatch = aiBatch;
    this.diagnostic = { running: false, rows: [] };
    this.telegram = telegram;
    this.now = now;
    this.sleep = sleep;
    this.running = false;
    this.lastError = null;
    this.configTail = Promise.resolve();
    this.timer = null;
    this.deliveryTimer = null;
    this.delivering = false;
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
    this.reconcileQueue();
    await this.store.save();
    return this;
  }
  async validate(kind, values = {}, locale = 'en') {
    const s = parseSettings(values, this.settings);
    try {
      if (kind === 'ai') return await validateAI(s);
      if (kind === 'telegram') return await validateTelegram(s);
    } catch (e) {
      const code = safeError(e);
      return {
        ok: false,
        code,
        message:
          e instanceof DeltaError ? messageFor(e.message, locale) : diagnosticMessage(code, locale),
      };
    }
    throw new DeltaError('bad_request', 'Unknown validation target');
  }
  profilePreview(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.some((id) => !profiles.some((p) => p.id === id)))
      throw new DeltaError('bad_request', 'Choose valid profiles');
    const values = mergeProfiles(ids);
    values.queries = lines(values.queries).slice(0, 12).join('\n');
    return { values, protectedKeys: ['profile'], activeProfiles: ids };
  }
  startDiagnostic({ ai = false } = {}) {
    if (this.running || this.diagnostic.running) return { accepted: false, running: true };
    this.diagnostic = { running: true, startedAt: this.now(), rows: [] };
    // A diagnostic shares the scan lock and respects source cooldowns. It never notifies or saves leads.
    this.running = true;
    const s = structuredClone(this.settings),
      now = this.now();
    s.freshnessHours = 24;
    void (async () => {
      try {
        for (const [name, connector] of Object.entries(this.connectors)) {
          if (this.stopped || !s[name + 'Enabled']) continue;
          const row = {
            source: name,
            checkedAt: now,
            count: 0,
            candidates: 0,
            verdict: '',
            error: '',
          };
          this.diagnostic.rows.push(row);
          if (this.store.data.sources[name]?.retryAt > now) {
            row.error = 'cooldown';
            continue;
          }
          try {
            const query = lines(s[name + 'Queries'] || s.queries)[0];
            const result = await connector.search(query, s, { now, cursor: null });
            const posts = result.posts
              .map((p) => normalize(name, p))
              .filter((p) => p && p.createdAt >= now - 86400000 && p.createdAt <= now + 300000);
            row.count = posts.length;
            row.query = query;
            const candidates = posts
              .map((post) => ({ post, rules: classify(post, s, now) }))
              .filter((p) => p.rules.verdict === 'lead');
            row.candidates = candidates.length;
            if (ai && candidates.length) {
              const p = candidates[0];
              if (this.store.data.aiRetryAt > this.now()) {
                row.verdict = 'pending_ai';
                row.error = 'ai_cooldown';
                continue;
              }
              try {
                const verdict = await this.ai(p.post, p.rules, s);
                row.verdict = verdict.verdict;
                row.reason = verdict.reason;
              } catch (e) {
                row.verdict = 'pending_ai';
                row.error = safeError(e);
                if (e.retryAfter || e.permanent) {
                  this.store.data.aiRetryAt =
                    this.now() + Math.max(e.permanent ? 3600000 : 60000, e.retryAfter || 0);
                  await this.store.save();
                }
              }
            } else row.verdict = candidates.length ? 'lead' : 'irrelevant';
          } catch (e) {
            row.error = safeError(e);
            if (e.retryAfter || row.error === 'http_429') {
              this.store.data.sources[name] = {
                ...(this.store.data.sources[name] || {}),
                error: row.error,
                retryAt: this.now() + Math.max(60000, e.retryAfter || 0),
              };
              await this.store.save();
            }
          }
        }
      } finally {
        this.diagnostic.running = false;
        this.diagnostic.finishedAt = this.now();
        this.running = false;
      }
    })().catch((e) => {
      this.diagnostic.error = safeError(e);
    });
    return {
      accepted: true,
      running: true,
      note: 'Sample: first query per enabled source, first page, last 24h; at most one AI call per source; no notifications.',
    };
  }
  diagnosticStatus(locale = 'en') {
    return {
      rows: this.diagnostic.rows.map((row) => ({
        ...row,
        verdict: statusLabel(row.verdict, locale),
        reason: messageFor(row.reason, locale),
        error:
          row.error === 'cooldown'
            ? locale === 'ru'
              ? 'Пауза источника'
              : 'Source cooldown'
            : row.error === 'ai_cooldown'
              ? locale === 'ru'
                ? 'Пауза AI'
                : 'AI cooldown'
              : diagnosticMessage(row.error, locale),
      })),
      total: this.diagnostic.rows.length,
      running: this.diagnostic.running,
    };
  }
  async configure(values) {
    const task = this.configTail.then(async () => {
      const next = parseSettings(values, this.settings);
      await atomicJson(join(this.dir, 'settings.json'), next);
      const aiChanged = ['aiApiKey', 'aiBaseUrl', 'aiModel'].some(
        (key) => next[key] !== this.settings[key],
      );
      const telegramChanged = ['telegramBotToken', 'telegramChatId', 'telegramEnabled'].some(
        (key) => next[key] !== this.settings[key],
      );
      this.settings = next;
      if (telegramChanged) {
        delete this.store.data.telegramRetryAt;
        delete this.store.data.telegramBlocked;
        for (const p of this.store.data.posts)
          if (
            p.verdict === 'lead' &&
            p.delivery?.state === 'failed' &&
            ['http_401', 'http_403'].includes(p.delivery.error)
          )
            p.delivery.state = 'pending';
      }
      this.reconcileQueue();
      await this.store.save();
      if (aiChanged) {
        delete this.store.data.aiRetryAt;
        await this.store.save();
      }
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
      aiRetryAt: this.store.data.aiRetryAt || 0,
      totals: d.totals,
      delivery: {
        running: this.delivering,
        retryAt: d.telegramRetryAt || 0,
        blocked: d.telegramBlocked || false,
        queued: d.posts.filter(
          (p) =>
            p.verdict === 'lead' &&
            ['waiting', 'pending', 'retry', 'sending'].includes(p.delivery?.state),
        ).length,
      },
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
              source +
              ': ' +
              (v.error === 'http_429' ? 'Rate limit reached. Search paused' : v.error) +
              '; retry in ' +
              Math.max(1, Math.ceil((v.retryAt - this.now()) / 60000)) +
              ' min',
            localizations: {
              ru:
                source +
                ': ' +
                (v.error === 'http_429' ? 'Лимит запросов. Поиск приостановлен' : v.error) +
                '; повтор через ' +
                Math.max(1, Math.ceil((v.retryAt - this.now()) / 60000)) +
                ' мин',
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
    Object.defineProperty(scan, 'collectAI', { value: true });
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
              await this.sleep(s.requestDelaySec * 1000);
            }
            if (this.stopped) break;
            await this.sleep(s.requestDelaySec * 1000);
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
      const pending = d.posts.filter((p) => p.verdict === 'pending_ai' && (p.retryAt || 0) <= now);
      const eligible = [];
      for (const post of pending) {
        post.rules = classify(post, s, now);
        if (post.rules.verdict !== 'lead') {
          post.verdict = post.rules.verdict;
          post.reason = post.rules.reason;
          continue;
        }
        eligible.push(post);
      }
      await this.store.save(); // Persist candidates before any paid model call.
      if (s.aiMode === 'batch' && s.aiEnabled) {
        for (
          let i = 0;
          i < eligible.length &&
          scan.aiCalls < s.maxAiPerScan &&
          !this.stopped &&
          !(this.store.data.aiRetryAt > this.now());
          i += s.aiBatchSize
        ) {
          const group = eligible.slice(i, i + s.aiBatchSize);
          scan.aiCalls++;
          try {
            const results = await this.aiBatch(group, s);
            for (const post of group) await this.decide(post, s, scan, now, results.get(post.id));
          } catch (e) {
            if (e.retryAfter || e.permanent)
              this.store.data.aiRetryAt =
                this.now() + Math.max(e.permanent ? 3600000 : 60000, e.retryAfter || 0);
            for (const post of group) {
              post.verdict = 'pending_ai';
              post.reason = 'AI unavailable: ' + safeError(e);
              post.retryAt = now + Math.max(60000, e.retryAfter || 0);
            }
            scan.errors++;
            if (e.retryAfter || e.permanent) break;
          }
          await this.store.save();
        }
      } else {
        let cursor = 0,
          halted = false;
        const worker = async () => {
          while (
            cursor < eligible.length &&
            !this.stopped &&
            !halted &&
            (!s.aiEnabled || !(this.store.data.aiRetryAt > this.now())) &&
            (!s.aiEnabled || scan.aiCalls < s.maxAiPerScan)
          ) {
            const post = eligible[cursor++];
            await this.decide(post, s, scan, now);
            if (post.aiBlocked) halted = true;
            delete post.aiBlocked;
          }
        };
        await Promise.all(
          Array.from({ length: s.aiMode === 'parallel' ? s.aiConcurrency : 1 }, worker),
        );
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
    if (rules.verdict === 'lead') {
      if (s.aiEnabled && scan.collectAI) {
        post.verdict = 'pending_ai';
        post.retryAt = now;
        post.reason = 'Waiting for AI';
      } else await this.decide(post, s, scan, now);
    } else if (rules.verdict === 'competitor') {
      scan.competitors++;
      d.totals.competitors++;
    } else {
      scan.excluded++;
      d.totals.excluded++;
    }
  }
  async decide(post, s, scan, now, supplied) {
    if (s.aiEnabled) {
      if (!supplied && scan.aiCalls >= s.maxAiPerScan) {
        post.verdict = 'pending_ai';
        post.reason = 'Waiting for next AI budget';
        post.retryAt = now + 60000;
        return;
      }
      if (!supplied) scan.aiCalls++;
      try {
        post.ai = supplied || (await this.ai(post, post.rules, s));
        post.verdict = post.ai.verdict;
        post.reason = post.ai.reason;
        delete post.retryAt;
      } catch (e) {
        post.verdict = 'pending_ai';
        post.reason = 'AI unavailable: ' + safeError(e);
        post.retryAt = now + Math.max(60000, e.retryAfter || 0);
        if (e.retryAfter || e.permanent)
          this.store.data.aiRetryAt =
            this.now() + Math.max(e.permanent ? 3600000 : 60000, e.retryAfter || 0);
        post.aiBlocked = !!(e.retryAfter || e.permanent);
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
        state: s.telegramEnabled ? 'pending' : 'waiting',
        attempts: 0,
        nextAt: now,
      };
      scan.leads++;
      this.store.data.totals.leads++;
      await this.store.save(); // Persist acceptance before discovery/AI continues.
    } else if (post.verdict === 'competitor') {
      scan.competitors++;
      this.store.data.totals.competitors++;
    } else if (!post.acceptedAt) {
      scan.excluded++;
      this.store.data.totals.excluded++;
    }
  }
  reconcileQueue(now = this.now()) {
    for (const p of this.store.data.posts) {
      if (
        p.verdict !== 'lead' ||
        !p.acceptedAt ||
        !p.delivery ||
        p.delivery.state === 'sent' ||
        p.delivery.sentAt
      )
        continue;
      if (!['disabled', 'waiting', 'pending', 'retry', 'sending'].includes(p.delivery.state))
        continue;
      if (now - p.createdAt > this.settings.freshnessHours * 3600000) {
        p.delivery.state = 'expired';
        continue;
      }
      if (['disabled', 'waiting'].includes(p.delivery.state))
        p.delivery.state = this.settings.telegramEnabled ? 'pending' : 'waiting';
    }
  }
  async drain() {
    const scan = {
      ts: this.now(),
      scanned: 0,
      leads: 0,
      competitors: 0,
      excluded: 0,
      sent: 0,
      aiCalls: 0,
      errors: 0,
    };
    await this.deliver(this.settings, scan, scan.ts);
    // Delivery runs independently from discovery; don't advance lastScanAt or count discoveries twice.
    if (scan.sent) {
      this.store.data.scans.push(scan);
      await this.store.save();
    }
    return { sent: scan.sent, ...this.status().delivery };
  }
  async deliver(_settings, scan, _now) {
    if (this.delivering) return;
    this.delivering = true;
    try {
      this.reconcileQueue();
      if (
        !this.settings.telegramEnabled ||
        this.store.data.telegramBlocked ||
        this.store.data.telegramRetryAt > this.now()
      )
        return;
      let attempts = 0;
      for (const p of this.store.data.posts) {
        const s = this.settings,
          now = this.now();
        if (this.stopped || !s.telegramEnabled || attempts >= s.maxTelegramPerScan) break;
        if (
          p.verdict !== 'lead' ||
          p.delivery?.sentAt ||
          !['pending', 'retry', 'sending'].includes(p.delivery?.state) ||
          p.delivery.nextAt > now
        )
          continue;
        if (now - p.createdAt > s.freshnessHours * 3600000) {
          p.delivery.state = 'expired';
          continue;
        }
        attempts++;
        p.delivery = {
          ...p.delivery,
          state: 'sending',
          attempts: (p.delivery.attempts || 0) + 1,
          lastAttemptAt: now,
        };
        // Claim is durable before the external side effect. Crashed sending is retried (at-least-once).
        await this.store.save();
        try {
          const result = await this.telegram(p, s);
          p.delivery = { ...p.delivery, ...result, state: 'sent', sentAt: this.now() };
          delete p.delivery.error;
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
          if (e.retryAfter) this.store.data.telegramRetryAt = p.delivery.nextAt;
          if (e.permanent) this.store.data.telegramBlocked = true;
          await this.store.save();
          if (e.retryAfter || e.permanent) break;
        }
        await this.sleep(1100);
      }
    } finally {
      try {
        await this.store.save();
      } finally {
        this.delivering = false;
      }
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
    const deliveryTick = async () => {
      if (this.stopped) return;
      try {
        await this.drain();
      } catch (e) {
        this.lastError = safeError(e);
      }
      if (!this.stopped) this.deliveryTimer = setTimeout(deliveryTick, 5000);
    };
    this.deliveryTimer = setTimeout(deliveryTick, 1000);
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.deliveryTimer);
    while (this.running || this.delivering) await wait(50);
    await this.store.tail;
  }
}
