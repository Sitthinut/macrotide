PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plans` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text,
	`markdown` text NOT NULL,
	`selected_model_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_plans`("id", "user_id", "markdown", "selected_model_id", "updated_at") SELECT "id", "user_id", "markdown", "selected_model_id", "updated_at" FROM `plans`;--> statement-breakpoint
DROP TABLE `plans`;--> statement-breakpoint
ALTER TABLE `__new_plans` RENAME TO `plans`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_plans_user` ON `plans` (`user_id`);