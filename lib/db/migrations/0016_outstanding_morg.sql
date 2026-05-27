CREATE TABLE `user_market_indicators` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`symbol` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_user_market_indicator` ON `user_market_indicators` (`user_id`,`symbol`);--> statement-breakpoint
CREATE INDEX `idx_user_market_indicator_order` ON `user_market_indicators` (`user_id`,`position`);