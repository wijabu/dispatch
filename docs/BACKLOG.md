# Backlog

Deferred ideas and known gaps, most-wanted first. Not commitments — a place so
they aren't lost.

## Craigslist reprice / relist automation
Today Craigslist is **fill-only** (the "Open & pre-fill" staged handoff posts the
initial listing; there's no in-app reprice or relist). Only OfferUp and Facebook
have one-click Sync-price / Relist, because they run through the Android emulator.
Craigslist's edit/renew lives behind its manage-page email-link auth, so it was
scoped out of v1.2.

Possible future work: drive Craigslist's manage page in the browser to reprice a
live post, and/or renew via the emailed renew link. Weigh against: Craigslist is
the lowest-priority channel, and its native renew is already a one-click email
link. The dashboard already *reminds* when a CL renew/reprice is due (from the CL
`relistPolicy`); only the execute is manual.

## Reddit (r/Watchexchange) posting via the emulator
Reddit has an Android app, so the OfferUp/Facebook emulator approach could drive
it. Caveats to design around first: r/Watchexchange requires a **timestamped
verification photo** per post (a manual artifact Wil must shoot), enforces a
strict `[WTS]` format + a **7-day repost cooldown**, and is heavily moderated
(ban risk on rule trips). Watch-only. Likely wants a fill-to-review-gate (like
Facebook) rather than full auto-submit. Do a feasibility probe + brainstorm
before building.

## Facebook Renew — live verification
The renew flow is wired but UNVERIFIED: the "Renew" control only appears on aging
listings, so it needs capture against a listing ~7+ days old.
