CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`kind` text NOT NULL,
	`file_path` text NOT NULL,
	`size_bytes` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `artifacts_video_kind_idx` ON `artifacts` (`video_id`,`kind`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_slug_unique` ON `categories` (`slug`);--> statement-breakpoint
CREATE TABLE `filao_brutos` (
	`filao_id` text NOT NULL,
	`video_id` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`filao_id`, `video_id`),
	FOREIGN KEY (`filao_id`) REFERENCES `filoes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `filao_brutos_video_idx` ON `filao_brutos` (`video_id`);--> statement-breakpoint
CREATE TABLE `filoes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `filoes_slug_unique` ON `filoes` (`slug`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text,
	`url` text NOT NULL,
	`status` text NOT NULL,
	`current_step` text,
	`progress_pct` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`force_whisper` integer DEFAULT false,
	`translate` integer DEFAULT false,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`platform` text DEFAULT 'youtube' NOT NULL,
	`title` text NOT NULL,
	`channel` text,
	`duration_sec` integer,
	`upload_date` text,
	`language` text,
	`thumbnail_path` text,
	`category_id` integer,
	`transcript_source` text,
	`created_at` integer NOT NULL,
	`last_opened_at` integer,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `videos_category_idx` ON `videos` (`category_id`);