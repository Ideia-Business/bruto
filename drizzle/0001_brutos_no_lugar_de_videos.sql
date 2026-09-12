-- A tabela nasceu `videos`; o léxico do produto (BRAND.md) chama o material de
-- `bruto`. Este é o único conteúdo da migração: o nome.
--
-- ESCRITA À MÃO, e não como o `drizzle-kit generate` a emitiu. O gerador
-- produziu, além do RENAME, a reconstrução completa das quatro tabelas
-- (CREATE `__new_x` / INSERT SELECT / DROP / RENAME) só para reescrever o texto
-- das chaves estrangeiras. Essa reconstrução é (a) desnecessária — desde o
-- SQLite 3.25 o próprio RENAME reescreve as FKs das tabelas filhas, o que foi
-- medido aqui antes de trocar o arquivo — e (b) QUEBRADA: ela se protege com
-- `PRAGMA foreign_keys=OFF`, que é NO-OP dentro de transação, e o migrator do
-- Drizzle roda tudo em transação. Com dado real na base, o DROP da tabela-pai
-- estoura SQLITE_CONSTRAINT_FOREIGNKEY e a migração morre no meio.
ALTER TABLE `videos` RENAME TO `brutos`;--> statement-breakpoint
-- O RENAME leva o índice junto, mas mantém o nome antigo dele.
DROP INDEX `videos_category_idx`;--> statement-breakpoint
CREATE INDEX `brutos_category_idx` ON `brutos` (`category_id`);
