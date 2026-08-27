-- One-time seed: Wil's past r/WatchExchange sales as tracked sold items.
-- Asking prices (from each post's details comment); sold_price left NULL —
-- final prices were DM-negotiated, so "not measured", never invented.
-- Brew Retrograph asking = $315 (reduced from $325 before it sold, verified
-- 2026-08-27). Run once: sqlite3 data/dispatch.db < scripts/seed-watchexchange-history.sql
INSERT INTO items (name, category, condition, status, asking_price, sold_channel, sold_at, created_at, updated_at) VALUES
 ('Sinn 556i RS', 'watches', 'excellent', 'sold', 1199, 'reddit-watchexchange', '2023-02-14 12:00:00', '2023-02-14 12:00:00', '2023-02-14 12:00:00'),
 ('Orient Commuter', 'watches', 'excellent', 'sold', 155, 'reddit-watchexchange', '2022-03-19 12:00:00', '2022-03-19 12:00:00', '2022-03-19 12:00:00'),
 ('Orient Mako II Pepsi', 'watches', 'excellent', 'sold', 115, 'reddit-watchexchange', '2022-03-19 12:00:00', '2022-03-19 12:00:00', '2022-03-19 12:00:00'),
 ('Oris Big Crown Pointer Date Oxblood', 'watches', 'excellent', 'sold', 1100, 'reddit-watchexchange', '2021-11-20 12:00:00', '2021-11-20 12:00:00', '2021-11-20 12:00:00'),
 ('Brew Retrograph Technicolor', 'watches', 'excellent', 'sold', 315, 'reddit-watchexchange', '2021-11-11 12:00:00', '2021-11-11 12:00:00', '2021-11-11 12:00:00'),
 ('Seiko Prospex SRPD35K1', 'watches', 'like_new', 'sold', 335, 'reddit-watchexchange', '2021-08-13 12:00:00', '2021-08-13 12:00:00', '2021-08-13 12:00:00'),
 ('Glycine Combat Sub Phantom GL0083', 'watches', 'excellent', 'sold', 275, 'reddit-watchexchange', '2021-01-04 12:00:00', '2021-01-04 12:00:00', '2021-01-04 12:00:00'),
 ('Glycine Combat Sub Black GL0261', 'watches', 'excellent', 'sold', 395, 'reddit-watchexchange', '2020-12-18 12:00:00', '2020-12-18 12:00:00', '2020-12-18 12:00:00');

INSERT INTO listings (item_id, publisher, url, listed_price, status, listed_at, ended_at)
SELECT i.id, 'reddit-watchexchange', u.url, i.asking_price, 'ended', i.sold_at, i.sold_at
FROM items i
JOIN (VALUES
 ('Sinn 556i RS','https://www.reddit.com/r/Watchexchange/comments/112hkhn/'),
 ('Orient Commuter','https://www.reddit.com/r/Watchexchange/comments/ti1del/'),
 ('Orient Mako II Pepsi','https://www.reddit.com/r/Watchexchange/comments/ti1aj9/'),
 ('Oris Big Crown Pointer Date Oxblood','https://www.reddit.com/r/Watchexchange/comments/qy5506/'),
 ('Brew Retrograph Technicolor','https://www.reddit.com/r/Watchexchange/comments/qrkdj0/'),
 ('Seiko Prospex SRPD35K1','https://www.reddit.com/r/Watchexchange/comments/p3cq0w/'),
 ('Glycine Combat Sub Phantom GL0083','https://www.reddit.com/r/Watchexchange/comments/kqa9dh/'),
 ('Glycine Combat Sub Black GL0261','https://www.reddit.com/r/Watchexchange/comments/kfmtuj/')
) AS u(name, url) ON u.name = i.name
WHERE i.sold_channel = 'reddit-watchexchange';
