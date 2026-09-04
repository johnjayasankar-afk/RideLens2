# Security review

Reviewed before v1 ship.

| Question                                   | Resolution                                                                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| Can users see another user's data?         | RLS on watches and child tables; API handlers also check `watch.userId === session.id`.                           |
| Can secrets leak?                          | Server-only env vars. Logger redacts key-like fields. No secrets in client bundles except public Supabase values. |
| Can a missing env var enable mocks?        | No. Fixture provider requires `E2E_TEST=1` and is rejected in production. Missing `PARSE_API_KEY` fails search.   |
| Can expired watches keep spending credits? | Dispatcher completes watches past `monitor_end_at` or with no remaining bookable dates before searching.          |
| Can retries explode cost?                  | Max 3 attempts, only transient codes, cache key reused after success.                                             |
| Can 3-date searches multiply unexpectedly? | Flexibility is 0–2. Dates generated centrally. Cross-watch dedup on canonical search key.                         |
| Can prices be misinterpreted?              | Unknown semantics exclude the fare from eligibility and alerts.                                                   |
| Can provider failure look like no savings? | `PROVIDER_ERROR` and `PARTIAL_SUCCESS` are first-class cycle statuses.                                            |
| Reservation / payment data?                | Not collected.                                                                                                    |
| Cron exposure?                             | Bearer `CRON_SECRET`. Internal health is also secret-gated.                                                       |
