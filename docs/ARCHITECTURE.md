# Review → analysis → alternatives → plan

## Code review (2026-10-16)

Reviewed `n-ycta/delta` kernel, external-component registration, package installer, supervisor, public API and platform guide; `delta-web` manifest/validation, settings forms, action delegation, notifications, metric queries and catalog; current storage/typing plugins; and the separate `delta-index` registry.

Findings:
- The current kernel is a capability router and lifecycle owner, not a workflow engine. External Node components register and long-poll invocations through `/v1/components`. No kernel feature or recompilation is necessary.
- Current installable plugins use `manifest.json` with `metadata.ui`, a release archive, explicit supervisor scopes and a SHA-256 entry in **delta/registry/plugins.json**. `delta-index/index.json` is a different/older source registry; it is not the web package catalog.
- The console already renders grouped typed settings, metrics, actions and plugin-owned notices. It lacked generic paginated result tables, action argument forms/output display and a capability-based notification feed.
- The service credential must never elevate a UI caller. All new reads/actions/feeds use the existing delegated capability checks and validate the selected installed node.
- Secret fields needed a configured-state marker and explicit clearing. A saved marker must never be sent back as a replacement secret.

## Analysis and alternatives

1. **Plugin-specific web page / iframe**: rejected. It couples the console to Leads or introduces a second auth/UI surface.
2. **Build delta-connect and delta-flow now**: rejected for this temporary personal deployment. It would require stabilizing two large public contracts before proving the workflow.
3. **One replaceable plugin with internal interfaces**: chosen. Connectors yield normalized posts; rules/AI classify; an independent delivery stage sends notifications. These are explicit future extraction boundaries.
4. **Scrape logged-in X/Threads with cookies or anti-bot workarounds**: rejected. Initial X/Threads support uses official APIs and reports missing permission/quota. Reddit supports RSS, JSON or approved OAuth; methods are explicitly selected, not silently switched around access denial.
5. **AI on every fetched post**: rejected for privacy, latency and cost. Cheap high-precision buyer/service rules run first. AI is optional and cannot bypass a rule rejection. AI errors fail closed; budgeted candidates remain pending.

## Plan implemented

1. Normalized `Post` envelope: stable source ID, canonical HTTPS permalink, timestamps, title/text/author/community.
2. Reddit RSS/Atom, public JSON, OAuth (client credentials or refresh token); X recent search; Threads keyword search; source-specific query overrides, bounded pagination and visible partial coverage.
3. RU/EN freelance preset: automation, websites, bots, scripts, parsers and integrations; buyer intent + service required; seller/exclusion rules precede acceptance.
4. Freshness, language and author controls, source/content dedupe, backoff, private durable state, bounded retention and per-scan budgets.
5. Optional OpenAI-compatible AI (including a localhost server), strict verdict/confidence validation, model/reason shown with each candidate.
6. Web notification feed, generic result tables, metric dashboard, manual rule preview/review, Telegram inline permalink and durable retry queue.
7. Release packaging, catalog registration, unit/mock-API tests plus real-kernel/browser integration checks.

## Future extraction

- `delta-connect`: connector interface `search(query, settings, {cursor, now}) -> {posts,cursor}`; normalization and canonical URL validation; rate-limit handling; notification transport `sendTelegram`.
- `delta-flow`: deterministic rule stage; AI classification stage; scan budgets/scheduler; dedupe and delivery state transitions. Each stage accepts ordinary JSON objects and owns no console UI.
- `delta-leads`: retain only the service profile, search preset and lead/review record schema after extraction. Do not expose a pretend n8n editor in this interim release.

The local repository/state is single-process. It is not a multi-worker queue. Telegram delivery is at-least-once: a crash or ambiguous network timeout after Telegram accepted a message but before its result was saved can cause a duplicate. The Bot API has no caller-supplied idempotency key.
