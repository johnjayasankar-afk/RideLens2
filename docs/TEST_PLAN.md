# RailDrop test plan

## Unit

- Money: dollar parsing, integer cents, thresholds, party totals.
- Search dates: ±0 / ±1 / ±2, month/year boundaries, leap year, past dates skipped.
- Ranking: cheapest wins across days; same price prefers desired date then preferred time then fewer transfers.
- Eligibility: Flexible kept; Value ignored by default; restricted included when enabled; wrong class / unavailable / Thruway excluded.
- Opportunity: first drop, unchanged, better price, better convenience, no qualifying.
- Timezone: DST start and DST end still resolve 08:00 ET.
- Normalizer: documented Parse `search_trains` sample; unknown price fails closed.

## Integration

- Initial scan requests three dates for a ±1 watch.
- Two identical watches share one provider search per date.
- One failed date → `PARTIAL_SUCCESS`, never `SUCCESS`.
- Manual second scan does not send a duplicate email.
- Rebook persists history and updates the benchmark.
- Dispatcher unique constraint skips a duplicate slot.

## E2E (Playwright against RailDrop)

- Auth via gated test session (`E2E_TEST=1` only).
- Create BOS → NYP ±1 watch.
- Immediate fixture scan (never used in production).
- 3-day strip, date badges, ranked list, Book on Amtrak + copy details.
- I rebooked, pause, resume, delete.
- Mobile 390px dashboard.

Playwright is never pointed at Amtrak for data extraction.

## Live contract (human key required)

If `PARSE_API_KEY` is present, run one `search_trains` for a future BOS–NYP date and record schema, price field, and party semantics. Do not spam the API.

If `RESEND_API_KEY` and `RESEND_FROM` are present, send one “RailDrop is ready” message.

## Booking handoff

Click the CTA. If a provider URL exists, use it. Otherwise open official Amtrak home and rely on copied trip details. Do not ship an unverified deep link.
