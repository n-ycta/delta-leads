# Delta Leads

**[English](README.md) · [Русский](README.ru.md)**

Temporary personal lead-search plugin for [Delta](https://github.com/n-ycta/delta). No plugin-specific code in Delta Web and no core patch. Designed to split into `delta-connect` and `delta-flow` later.

**RU/EN buyers, not service ads.** Searches automation, websites/landing pages, bots, scripts, scrapers and API integrations. Combines explicit buyer-intent phrases with service keywords, excludes sellers/competitors, checks freshness, deduplicates posts and optionally asks an AI model for a final verdict.

## Install / quick start

1. Update **Delta Web to 0.6.2+** (UI contract 1.5).
2. In **Plugins → Delta Leads → Install**, choose your node. The official catalog installs a checksum-verified release and a scoped supervisor component. No manually pasted Delta admin token is needed.
3. Open **Settings**. The RU/EN freelance preset is already loaded. Default source: Reddit RSS, every 5 minutes, posts no older than 24 hours. Searching runs on the node even when the browser is closed.
4. In **Telegram**, set your **bot token** and **recipient chat ID**, then enable delivery. Open the bot and press **Start** first. Use **Send** in the action menu. Bot credentials are secret inputs, never bundled in the plugin or returned in API responses.
5. In **AI verdict**, optionally enable your OpenAI-compatible provider, set its base URL/model/key, your service profile and confidence threshold. A local model can use `http://127.0.0.1:11434/v1`. Public post text is sent to this configured provider only if AI is enabled.
6. Run **Scan**. In the overview, inspect **Posts & verdicts** and **Source health & coverage**. The scan action returns immediately; scanning itself continues in the background.
7. Open the generated plugin dashboard for unique checked posts, accepted leads, competitors, excluded posts and Telegram delivery over time. The console inbox receives accepted leads independently of Telegram.

API equivalent: `delta call packages.install --json '{"id":"dev.delta.leads"}'`. Then manage the plugin through capabilities; all private-content and configuration endpoints require owner/admin or an explicit `admin:leads.*` grant.

## Tune your search

- **queries**: up to 12 queries, one per line. Syntax belongs to the selected social network, not to a fictional universal query language.
- **services / buyerTerms / sellerTerms / excludedTerms**: editable phrase lists. Latin terms use word boundaries; Russian stems allow inflections.
- **subreddits**: preset `forhire, slavelabour, freelance_forhire, Entrepreneur, smallbusiness`. Empty = all Reddit. No individual community availability is guaranteed.
- **freshnessHours**: 1–168 hours; **intervalSec**: at least 60 seconds. Long-running scans never overlap.
- **xQueries / threadsQueries**: source-specific queries. Threads takes ordinary keyword phrases, not Reddit Boolean syntax.
- **profile / aiMinConfidence**: your services and model threshold. Low confidence means `uncertain`; provider failure means `pending_ai`, never an alert.
- **notificationLocale**: Telegram message and inline-button language, English or Russian. Web text follows the console's language selector.
- **Review a lead**: record `relevant`, `false_positive`, `contacted` or `won` using its ID from the table. This is manual feedback, not undisclosed automatic training.
- **Test matching rules**: preview text without sending notifications or calling AI. Real candidate AI verdicts are displayed separately.

## Sources / access methods

| Source | Methods | Requirements / limits |
| --- | --- | --- |
| Reddit | Public RSS/Atom, public JSON, OAuth API | Public access can be restricted by Reddit/network. OAuth requires your app credentials and approved access where required. A refresh token is optional for user-authorized flows; otherwise client credentials are used. |
| X | Official `/2/tweets/search/recent` API | Bearer token and an API plan/permission permitting recent search. At most the API's recent-search window. Not a promise of free scraping. |
| Threads | Official `/v1.0/keyword_search` API | User access token with `threads_basic` and approved `threads_keyword_search` for other users' public posts. Without approval, search coverage may be restricted to your own posts. |

- No cookie/password collection, CAPTCHA circumvention, browser automation or automatic auth-denial fallback.
- Rate limits/auth/network failures are visible in Sources and retried with backoff. An access method is explicitly selected; switching methods requires you to change settings.
- Maximum three pages per query, 100 posts per page where supported. RSS is a bounded feed, not an exhaustive crawl. `partial` reports hitting a pagination cap or a failed source. A successful scan does **not** guarantee every social post was indexed.
- Sources may return edited/deleted content, unsupported search syntax or empty results. Posts outside the selected age window are dropped locally as well.

Official docs: [Reddit API](https://www.reddit.com/dev/api/), [OAuth](https://github.com/reddit-archive/reddit/wiki/OAuth2), [X recent search](https://docs.x.com/x-api/posts/recent-search), [Threads keyword search](https://developers.facebook.com/docs/threads/keyword-search), [Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage).

## Accuracy and delivery

A rule lead needs **both** buyer intent and a matching service. Seller phrases win over buyer phrases. AI only analyzes rule-passing candidates; it cannot turn an irrelevant/seller post into a lead. The default rule threshold is 75 and AI confidence is 0.85. These are conservative starting settings, **not measured precision or a guarantee of clients**. Tune the preset against your own reviewed results.

AI reasons, confidence and model are visible in the table and Telegram. `pending_ai` is retried subject to freshness and the per-scan AI budget. Accepted leads are available in the web inbox even when Telegram is disabled. Every accepted lead is queued durably, even before Telegram is configured. Enabling delivery migrates legacy disabled records and sends still-fresh unsent leads. An independent worker drains the queue even if discovery is disabled or a source is rate-limited. Telegram Retry-After pauses the whole queue; changing connection settings clears an authentication pause. Queued stale leads expire. Sent messages are not normally resent; permanent Telegram 4xx errors remain visibly `failed`, and transient failures retry with backoff.

**Delivery is at-least-once, not exactly-once**: network ambiguity or a crash between Telegram acceptance and local persistence can duplicate a message. No automatic outreach, comments or DMs to prospects are sent.

## API

All calls use the core `/v1/call` boundary. Component ID: `leads`, UI ID: `dev.delta.leads`.

| Capability | Input / output |
| --- | --- |
| `leads.status` | Sanitized settings, configured-secret key names, running state, source health, lifetime counters and notices |
| `leads.settings` | Omit `values` to read; otherwise partial `{values:{...}}` update. Empty secret string explicitly clears it. |
| `leads.scan_now` | Starts a scan if not already running; returns `{accepted,running}` |
| `leads.list` | `{verdict?,search?,offset?,limit?}` → `{rows,total}`; max 100 rows |
| `leads.statistics`, `leads.sources` | Generic `{rows,total}` tables |
| `leads.notifications` | Up to 100 recent accepted lead notifications; no secrets |
| `leads.metrics_query` | `{query:{metricId,range:{from,to},stepMs?,aggregation:"sum"}}` → series/summary |
| `leads.preview` | `{title,text}` → deterministic rules verdict; no external side effects |
| `leads.feedback` | `{id,review}` → saved manual review |
| `leads.test_telegram` | One test message to the configured recipient |

## State and security

`DATA_DIR` contains private `settings.json` and `state.json`. Writes use serialized atomic replacement, owner-only files (0600) and directory (0700) on POSIX. On Windows use a private user-profile directory and appropriate account ACLs. Secrets are stored locally in plaintext for runtime use, **not encrypted at rest**; do not put this directory in Git or expose it via HTTP. Raw response bodies and credentials are not logged or returned as errors. State is pruned on scans and keeps at most 5,000 post records, 30,000 seen keys and 3,000 scan buckets, within the selected 1–90 day retention. Lifetime counters survive pruning; chart history is retained scan history, so older/high-frequency buckets may be truncated by the cap.

The plugin is a standard Delta process, not a sandbox: it needs outbound HTTPS and local data-directory write access. It does not have storage/system/token administration privileges. AI base URLs are owner-configured; HTTPS is required except for localhost HTTP. Do not point the AI client at an untrusted endpoint or give it a provider key that endpoint should not receive.

## Development

Node 22+; recommended Node 24.

```sh
npm ci
npm test
# Manual development: provide DELTA_URL, scoped DELTA_TOKEN and private DATA_DIR.
npm start
```

See [architecture and review](docs/ARCHITECTURE.md) and [verification](docs/VERIFICATION.md). No real bot/provider credentials belong in tests or fixtures.

## Profiles and diagnostics (0.1.2)

Open **Settings → Profiles**, select one or more specializations, then **Preview**. Each checkbox authorizes replacement of that field; unchecked fields keep your values. Previously customized fields are not preselected; the AI prompt is always protected by default. Reopen Profiles to reset individual fields to the merged profile. **Apply** changes only the form; **Save** persists it. Profile ordering is deterministic; duplicate lines are removed. No credentials or notification settings are overwritten by profiles.

The **AI** and **Telegram** settings buttons validate the current draft without saving it. AI performs one actual structured completion (potentially billable), not just a model-list request; it reports the verdict/confidence. Telegram checks getMe/getChat; **Send** separately verifies message delivery. A successful getChat does not guarantee future delivery.

Choose AI **sequential**, **parallel** (1–8 concurrent single-post requests), or **batch** (1–10 posts per JSON request). `maxAiPerScan` limits HTTP model calls, not posts; batch mode can analyze at most budget × batch-size posts. JSON batches require exactly one valid result per input ID; duplicate, foreign or missing IDs reject the batch. Provider 429/authorization failures pause the shared AI queue across scans/restarts; replacing the key, URL or model clears that AI cooldown. Disable `aiJsonMode` if your compatible provider does not support response_format. Interactive validation uses a maximum 25-second timeout.

**Diagnose** is a read-only last-24h sample: first query, first page, per enabled source, optionally one AI candidate per source. It shares the scan lock, respects cooldowns and does not save leads or send notifications. Watch **Diagnostics** for results. Normal scheduled searches remain controlled separately by Enabled.

Additional APIs: `leads.validate_ai({values?})`, `leads.validate_telegram({values?})`, `leads.diagnose({ai?:boolean})`, `leads.diagnostics({_locale?})`, `leads.profiles({ids:[...]})` (preview only; apply selected values with leads.settings). Validation returns `{ok, ...}` with a safe diagnostic code/message on failure. Omitted secret values reuse saved credentials; an explicit empty secret clears it on Save. Full parameter schemas are published in the core catalog for MCP clients.

### Conditional controls and lead table (Web 0.6.2+)

Settings show only the controls relevant to the selected integration/mode. Parallel request count and JSON batch size are mutually exclusive. Switching modes preserves saved values and the form draft. The generated dashboard uses the existing Table widget with clickable HTTPS post titles, newest-first records, verdicts and Telegram status; saved layouts are not reset.
