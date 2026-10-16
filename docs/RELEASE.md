Delta Leads 0.1.4 — readable Telegram messages and safer delivery. Recommended companion: Delta Web 0.6.4.

- HTML messages with bold headings, separate metadata, preserved paragraphs, quoted excerpts and a one-word inline post link. Untrusted text is escaped and length-bounded before escaping.
- Localized 24-hour timestamps and a configurable IANA notification timezone (default UTC).
- One malformed notification no longer pauses the whole queue. Authentication/chat-access errors pause delivery; connection changes allow retry. HTTP 429 respects Telegram JSON retry_after as well as headers.
- Rule matching requires service terms near the buyer intent in the same request, reducing false positives from unrelated company bios. The AI instructions explicitly exclude unrelated assistant/support/sales jobs. This is a heuristic, not a precision guarantee.
- Persistent queue, profiles, custom prompts, history and settings are retained. Delivery is at-least-once; an ambiguous network failure can still lead to a duplicate.
