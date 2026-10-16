# Verification / Проверки

Date: 2026-10-16. Node.js 24; isolated Delta node 0.4.1 official Linux x64 binary (release SHA-256 verified). No user production node was modified during local tests.

## Completed

- **49 plugin automated tests**: RU/EN buyer vs seller/advice/job-seeker examples; word boundaries; freshness/future dates; language/author filters; query/credential validation; secret redaction and clearing; RSS parsing and DTD rejection; OAuth token caching; X/Threads request contracts and pagination; API rate limits; response-size bounds; Telegram URL/button/language; durable queue and retries; duplicate/crosspost suppression; source backoff; AI budgets/fail-closed output; settings serialization; localized stable verdict codes; manifest/version checks and complete RU labels/help/options.
- **Delta Web**: 25 client contract/layout-generation tests, 46 server tests, production build and EN/RU locale parity checks. New tests cover namespace restrictions, caller delegation, installed-node selection, action inputs/outputs, safe plugin notifications, read state, maximum output size and old-contract incompatibility.
- **Real core integration**: core → registered Leads + Storage + Web; plugin discovery; paginated declarative views; rule preview action input/result; notifications and persisted read state; metric query (including UI time presets and previous-period comparison); restricted token denied private data and privilege escalation. Storage used the local-file backend; no database service was required.
- **Local Chromium, RU and EN**, 1440×1000 and 390×844: readable, horizontally scrolling table inside its container; no page-wide mobile overflow; translated filters, labels and verdict; safe links; typed action form and visible JSON result; no browser errors. Screenshots were visually reviewed. New plugin code uses consistent two-space indentation.
- **Live Reddit RSS**: public feed reachable from the test environment, returned 49 valid normalized post envelopes for a sample query. This verifies connectivity/parsing, not lead quality or exhaustive coverage.
- **Live Telegram**: one explicitly labeled test message with inline link delivered to the user-provided recipient. The token/chat ID were not placed in Git, presets, fixtures or releases.
- **Official package installation**: `packages.install` downloaded the published Leads 0.1.1 release using the official catalog checksum, installed production dependencies, created a scoped supervisor process, registered the packaged component, preserved private settings and served preset-based dashboard metrics. This was an isolated test node, not the user's production installation.
- **Generated dashboard in Chromium**: actual UI preset-based metric requests returned complete envelopes without browser errors.
- Real credentials scanned out of both publishable source trees before publication.

## Not claimed

- No measured production precision/recall or guarantee of paying customers. Rule tests are synthetic examples, not a labeled production benchmark.
- No live AI-provider verdict check: no provider credentials/model endpoint were supplied. Malformed output, low confidence and outage behavior were tested with controlled responses.
- No live X/Threads account check: adapters were tested with fixtures. User tokens and authorized API access are required.
- No production deployment to the user's machine or ongoing monitoring was started. The release is installed/configured through the user's Delta Web.
- Delivery is at-least-once. Telegram/network ambiguity can produce duplicates after a crash; exactly-once delivery is not possible with Bot API sendMessage alone.

The GitHub release workflows repeat automated tests before building packages. The official catalog records the downloaded release asset's SHA-256, not an assumed locally generated checksum.
