CREATE TABLE `fund_catalog` (
	`proj_id` text PRIMARY KEY NOT NULL,
	`abbr_name` text,
	`thai_name` text,
	`english_name` text,
	`amc_name` text,
	`fund_type` text,
	`policy_desc` text,
	`asset_class` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_fund_catalog_asset_class` ON `fund_catalog` (`asset_class`);--> statement-breakpoint
CREATE INDEX `idx_fund_catalog_fund_type` ON `fund_catalog` (`fund_type`);--> statement-breakpoint
CREATE TABLE `fund_fees` (
	`proj_id` text NOT NULL,
	`fund_class_name` text NOT NULL,
	`fee_type` text NOT NULL,
	`fee_type_raw` text NOT NULL,
	`rate_ceiling_pct` real,
	`actual_rate_pct` real,
	`period_start` text NOT NULL,
	`period_end` text,
	`prospectus_type` text,
	`last_upd_date` text,
	PRIMARY KEY(`proj_id`, `fund_class_name`, `fee_type_raw`, `period_start`),
	FOREIGN KEY (`proj_id`) REFERENCES `fund_catalog`(`proj_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_fund_fees_current` ON `fund_fees` (`proj_id`,`fee_type`,`period_end`);