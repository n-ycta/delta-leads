Personal RU/EN lead discovery for Delta. Requires Delta Web 0.6.0+ (UI contract 1.5).

- Reddit RSS/Atom, public JSON and OAuth; optional official X/Threads search adapters.
- Configurable buyer/service/seller rules, freshness, check intervals, language/author filters and crosspost deduplication.
- Optional OpenAI-compatible AI verdict with confidence/reason/model; errors hold candidates, never silently approve them.
- Web inbox, declarative result tables, metric dashboard, manual review and preview.
- Telegram inline post link, persistent delivery queue, visible errors, rate-limit backoff and per-scan budgets.
- Configured secrets are never echoed; private atomic local state; no core changes.

X/Threads require your own authorized API access. AI accuracy and production delivery depend on your provider, credentials and settings; no precision guarantee. No prospect outreach is sent. See README for installation, API, retention and at-least-once delivery limitations.

Patch 0.1.1: complete metric-result envelope, dashboard time presets, automatic bucket sizing and previous-period comparison.
