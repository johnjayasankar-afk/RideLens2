# Failure modes & mitigations

| Scenario | Mitigation |
| --- | --- |
| Obi down | Session continues with other enabled sources; UI shows Obi error locally |
| Curb disagrees with Obi | Reconciler picks higher-score quote; material delta → discrepancy message |
| Uber result is a range | Display full range; ranking uses midpoint internally only |
| Lyft product rename | Taxonomy fallback to OTHER until mapped |
| Empower estimate only | Always ESTIMATE label; never “locked” |
| Quote expires on screen | Freshness EXPIRED; excluded from ranking; refresh CTA |
| Rapid refresh | Server rate limit + short cache TTL + debounce |
| Location moves | Refresh uses new coords only after user action / refresh |
| Slightly different geocodes | Single canonical geocode per session for all sources |
| Unexpected currency | Pass through ISO code; format with Intl |
| Malformed source JSON | Zod fail → source error, no crash |
| Account-linked cache bleed | Cache key includes account context; linked blocked from public keys |
| Malicious booking URL | Allowlist reject |
| Expensive APIs | Usage counters, rate limits, cache, source timeouts |
| Partner terms change | Capability flags + SETUP_REQUIRED; kill-switch env flags |
| 15s source latency | Per-source timeout (default 8s); progressive UI shows early results |
| Production mock-only | `assertNoSilentMocks`; `isProductionLiveCapable` banner; fixtures forbidden |
