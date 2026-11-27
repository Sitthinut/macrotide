-- Broker sync settings (the login label and account order) are now keyed per
-- user (`<name>:<userId>:<source>`). Drop the older shared rows, which the app
-- no longer reads; the next sync writes each user's own. Idempotent.
DELETE FROM `settings` WHERE `key` GLOB 'broker_login_label:*' OR `key` GLOB 'broker_account_order:*';
