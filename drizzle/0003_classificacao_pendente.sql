ALTER TABLE `brutos` ADD `classificacao_pendente` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Vídeo antigo SEM categoria ainda precisa de classificação: sem isto o default
-- false o escondia da lista de pendentes (P1 do Codex, 30/09, parte aceita —
-- "pendente" significa categoria não decidida, não "sem tags").
UPDATE `brutos` SET `classificacao_pendente` = true WHERE `category_id` IS NULL;
