DROP INDEX `idx_fund_catalog_fund_type`;--> statement-breakpoint
ALTER TABLE `fund_catalog` ADD `policy_desc_th` text;--> statement-breakpoint
ALTER TABLE `fund_catalog` ADD `management_style` text;--> statement-breakpoint
ALTER TABLE `fund_catalog` ADD `tax_incentive_type` text;--> statement-breakpoint
ALTER TABLE `fund_catalog` ADD `distribution_policy` text;--> statement-breakpoint
ALTER TABLE `fund_catalog` ADD `invest_region` text;--> statement-breakpoint
ALTER TABLE `fund_catalog` ADD `is_feeder_fund` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `fund_catalog` ADD `feeder_master_fund` text;--> statement-breakpoint
ALTER TABLE `fund_catalog` ADD `is_fixed_term` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `fund_catalog` ADD `init_date` text;--> statement-breakpoint
ALTER TABLE `fund_catalog` ADD `isin_code` text;--> statement-breakpoint
ALTER TABLE `fund_catalog` ADD `aum` real;--> statement-breakpoint
ALTER TABLE `fund_catalog` ADD `aum_date` text;--> statement-breakpoint
ALTER TABLE `fund_catalog` ADD `sec_status` text;--> statement-breakpoint
CREATE INDEX `idx_fund_catalog_status` ON `fund_catalog` (`status`);--> statement-breakpoint
CREATE INDEX `idx_fund_catalog_mgmt_style` ON `fund_catalog` (`management_style`);--> statement-breakpoint
CREATE INDEX `idx_fund_catalog_tax` ON `fund_catalog` (`tax_incentive_type`);