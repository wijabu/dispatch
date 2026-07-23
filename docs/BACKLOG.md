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
it. Watch-only channel. Feasible, but design around these r/Watchexchange
specifics (do a feasibility probe + brainstorm before building):

- **Timestamped verification photo, current-dated, per post.** A handwritten
  note with the seller's username + the CURRENT date, placed under the watch.
  The date must be current, so a **repost can't reuse the original photo** — a
  fresh timestamp photo is shot each 7-day relist cycle. Manual input every
  cycle (but marginal — photos are shot by hand anyway).
- **Account seasoning prerequisite.** Posting requires a Reddit account **30+
  days old with positive karma**. The marketplace account must be seasoned first
  (same "set up ahead" situation Facebook had).
- **Details go in a top-level comment, not the post.** Convention is
  `[WTS] Brand Model` title + photos, with price/sale details in a comment the
  seller posts. Automation must post the thread AND then add a details comment —
  a structural difference from the single-form marketplace flows.
- **Strict `[WTS]` format, 7-day repost cooldown, heavy moderation** (ban risk on
  rule trips) → favor a fill-to-review-gate (like Facebook), not full auto-submit.

Design shape: **first post** = fill title + photos + details comment to a review
gate; add the verification photo + confirm compliance + submit yourself.
**Relist** (7-day) = drop in a fresh-dated timestamp photo, Dispatch reposts the
`[WTS]` + re-adds the details comment, stops for review.

## Facebook Renew — live verification
The renew flow is wired but UNVERIFIED: the "Renew" control only appears on aging
listings, so it needs capture against a listing ~7+ days old.
