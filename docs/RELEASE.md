Delta Leads 0.1.2 — reliability, diagnostics and composable search profiles. Update Delta Web to **0.6.1+** for the complete UI.

- Select and combine AI automation, websites/landing pages, bots/scripts and illustration/design profiles. Preview each changed field, preserve custom keywords, and explicitly opt in before replacing your AI prompt. Save remains a separate action.
- AI processing: sequential requests, bounded parallel requests or strict ID-mapped JSON batches. Request/batch limits, timeouts and optional provider JSON mode are configurable. Invalid results fail closed; errors never approve leads.
- Shared persistent AI cooldown and source request pacing respect rate limits. Reddit 429 is shown as a pause, not a malformed notification. No automatic access-method switching or access-control bypass.
- Validate AI endpoint, authentication, model and structured output using current form values without saving. Validate Telegram identity/chat access without sending; a separate Send action tests delivery.
- Background Diagnostics samples the first query/page of each enabled source over the last 24h; optional one-candidate AI test, no lead saves or Telegram notifications. This is not an exhaustive crawl.
- MCP discovery now has typed settings/actions/inputs. Web 0.6.1 discovers installed plugin methods with explicit least-privilege scopes and routes remote metrics correctly.
- RU/EN, compact forms, themed multiline editor, icon-only secret clear, and plugin dashboard classification are handled generically by Web.

Provider/API access and working credentials are still required. No claim of measured precision, exhaustive coverage or exactly-once delivery. Existing private settings/history are retained. No automatic contact with prospects.
