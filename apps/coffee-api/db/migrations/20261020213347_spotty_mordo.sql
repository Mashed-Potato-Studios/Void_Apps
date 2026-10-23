CREATE TABLE `coffee_stats` (
	`id` text PRIMARY KEY NOT NULL,
	`top_menu_item_id` text,
	`computed_at` text NOT NULL,
	FOREIGN KEY (`top_menu_item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cron_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_name` text NOT NULL,
	`cron` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`items_processed` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `menu_items` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`origin` text NOT NULL,
	`price_cents` integer NOT NULL,
	`stock` integer DEFAULT 0 NOT NULL,
	`default_stock` integer DEFAULT 10 NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_items_slug_unique` ON `menu_items` (`slug`);--> statement-breakpoint
CREATE TABLE `order_items` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`menu_item_id` text NOT NULL,
	`qty` integer DEFAULT 1 NOT NULL,
	`price_cents` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`menu_item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`total_cents` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL
);
