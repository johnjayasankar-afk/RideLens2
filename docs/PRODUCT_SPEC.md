# RailDrop product spec

**Know when your train gets cheaper.**
Book the flexible fare. RailDrop watches the rest.

## Who it is for

A traveler who already bought an Amtrak ticket — usually Flexible — and wants to know if the same origin and destination can be ridden for less in a short window around the desired date.

## What it watches

Not the original train number. Not the original departure time. Not only the original service.

Default window: desired date `D` ± 1 calendar day. Architecture also supports exact date and ±2.

Every bookable Amtrak **rail** itinerary between the chosen stations is eligible: Northeast Regional, Acela, other named trains, and connecting rail. Thruway/bus is identified and excluded unless the user opts in.

Preferred departure time is optional and ranks only. Cheaper trains outside that hour still appear.

## Comparison

Benchmark is `current_booked_price_cents` — the actual total paid. Integer cents only. Default compare is Flexible → Flexible. Restricted families can be surfaced separately and are never implied to have the same rules.

A candidate qualifies when

`candidate.total_party_price_cents <= booked - minimum_savings_cents`

with a $1 default threshold.

## Immediate value

Creating a watch runs one `INITIAL` scan immediately, then three scheduled local slots (08:00 / 14:00 / 20:00) per day until the monitoring window ends (default 48 hours after `booked_at`).

## Alerts

One email when a qualifying fare first appears, when the best price improves by at least $1, or when a same-day option appears within $10 of the current best after only off-day options existed. Unchanged results are silent.

The email CTA opens the RailDrop watch. Booking continues on Amtrak with copied itinerary details.

## I rebooked

The previous benchmark is stored as a price event. Monitoring continues against the new total. History is never erased.

## Non-goals

Automated rebooking, scraping Amtrak, storing payment data, or inventing official deep links that have not been verified.
