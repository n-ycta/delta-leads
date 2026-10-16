Delta Leads 0.1.3 — persistent delivery, clickable lead tables and conditional settings. Update Delta Web to **0.6.2+** first (UI contract 1.6).

- Every accepted lead is persisted in the delivery queue, including leads discovered before Telegram was configured. Enabling Telegram picks up still-fresh unsent leads; legacy `disabled` records migrate automatically. Expired leads are not sent, and recorded sent messages are not replayed.
- Independent delivery scheduler runs even when discovery is disabled, slow or waiting on a Reddit cooldown. One send worker, durable retries, shared Telegram Retry-After cooldown, and visible waiting/retry/failure states.
- Authentication failures pause delivery. Changing Telegram connection settings allows a retry of authentication-failed leads. Delivery remains at-least-once: network ambiguity or a crash can still cause a duplicate.
- A New leads table uses Web's existing Table widget: newest-first posts, clickable post titles, source, verdict, AI confidence/reason and delivery state. Existing saved generated dashboards gain the table without layout reset.
- Declarative settings branches: AI parallelism only in parallel mode, batch size only in batch mode, OAuth fields only in OAuth mode, and disabled integrations hide irrelevant controls. Hidden values remain saved and return on switching back.
- Existing private settings, custom prompts, profiles and history are retained. No automatic outreach or access-control bypass.
