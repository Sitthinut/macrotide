CREATE TABLE `buckets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type_label` text,
	`icon` text,
	`brokerage` text NOT NULL,
	`goal_text` text,
	`target_allocation` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_call_id` text,
	`feedback` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_messages_thread` ON `chat_messages` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `chat_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fund_quotes` (
	`ticker` text PRIMARY KEY NOT NULL,
	`nav` real NOT NULL,
	`d1_pct` real,
	`ytd_pct` real,
	`y1_pct` real,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `holdings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bucket_id` text NOT NULL,
	`ticker` text NOT NULL,
	`thai_name` text,
	`english_name` text NOT NULL,
	`category` text,
	`asset_class` text,
	`region` text,
	`units` real NOT NULL,
	`avg_cost` real,
	`ter` real,
	`color` text,
	`source` text,
	`acquired_on` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`bucket_id`) REFERENCES `buckets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_holdings_bucket` ON `holdings` (`bucket_id`);--> statement-breakpoint
CREATE TABLE `journal_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`title` text,
	`body` text,
	`url` text,
	`source` text,
	`tags` text,
	`pinned` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_journal_kind` ON `journal_entries` (`kind`);--> statement-breakpoint
CREATE INDEX `idx_journal_created` ON `journal_entries` (`created_at`);--> statement-breakpoint
CREATE TABLE `model_portfolios` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`built_in` integer DEFAULT false NOT NULL,
	`allocation` text NOT NULL,
	`expected_return` real,
	`expected_volatility` real,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nav_history` (
	`ticker` text NOT NULL,
	`date` text NOT NULL,
	`nav` real NOT NULL,
	PRIMARY KEY(`ticker`, `date`)
);
--> statement-breakpoint
CREATE INDEX `idx_nav_history_date` ON `nav_history` (`date`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` integer PRIMARY KEY NOT NULL,
	`markdown` text NOT NULL,
	`selected_model_id` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
