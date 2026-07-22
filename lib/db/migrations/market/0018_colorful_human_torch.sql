PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_us_dividends` (
	`symbol` text NOT NULL,
	`ex_date` text NOT NULL,
	`payable_date` text,
	`record_date` text,
	`cash_amount` real,
	`special` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_us_dividends`("symbol", "ex_date", "payable_date", "record_date", "cash_amount", "special") SELECT "symbol", "ex_date", "payable_date", "record_date", "cash_amount", "special" FROM `us_dividends`;--> statement-breakpoint
DROP TABLE `us_dividends`;--> statement-breakpoint
ALTER TABLE `__new_us_dividends` RENAME TO `us_dividends`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_us_dividends_symbol_ex` ON `us_dividends` (`symbol`,`ex_date`);--> statement-breakpoint
CREATE TABLE `__new_fund_share_classes` (
	`proj_id` text NOT NULL,
	`class_name` text NOT NULL,
	`ticker` text,
	`class_detail_th` text,
	`distribution_policy` text,
	`investor_type` text,
	`tax_incentive_type` text,
	`isin_code` text,
	`current_ter` real,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	PRIMARY KEY(`proj_id`, `class_name`),
	FOREIGN KEY (`proj_id`) REFERENCES `fund_catalog`(`proj_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_fund_share_classes`("proj_id", "class_name", "ticker", "class_detail_th", "distribution_policy", "investor_type", "tax_incentive_type", "isin_code", "current_ter", "created_at", "updated_at") SELECT "proj_id", "class_name", "ticker", "class_detail_th", "distribution_policy", "investor_type", "tax_incentive_type", "isin_code", "current_ter", "created_at", "updated_at" FROM `fund_share_classes`;--> statement-breakpoint
DROP TABLE `fund_share_classes`;--> statement-breakpoint
ALTER TABLE `__new_fund_share_classes` RENAME TO `fund_share_classes`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_fund_share_classes_ticker` ON `fund_share_classes` (`ticker`);--> statement-breakpoint
CREATE INDEX `idx_fund_share_classes_proj` ON `fund_share_classes` (`proj_id`);--> statement-breakpoint
CREATE INDEX `idx_fund_share_classes_tax` ON `fund_share_classes` (`tax_incentive_type`);--> statement-breakpoint
CREATE INDEX `idx_fund_share_classes_investor` ON `fund_share_classes` (`investor_type`);--> statement-breakpoint
CREATE INDEX `idx_fund_share_classes_isin` ON `fund_share_classes` (`isin_code`);