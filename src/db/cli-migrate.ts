/**
 * Entrypoint de CLI das migrações (`npm run db:migrate`).
 *
 * Separado de `migrate.ts` de propósito: o gatilho "sou o módulo principal?"
 * (`import.meta.url` vs `fs.realpathSync(process.argv[1])`) fazia o tracer do
 * build standalone varrer o projeto atrás do argv dinâmico e arrastar a
 * toolchain do build (o `node` de `dist/build/`, o npm) para o payload de
 * runtime — medido nesta lane: `.next/standalone` com 520 MB, 441 MB deles
 * em `.next/standalone/dist` (achado P2 do Codex, confirmado no artefato).
 *
 * A regra que este arquivo materializa: módulo importado pelo servidor só
 * exporta função (`migrate.ts`); módulo de CLI só é executado (este). Nenhum
 * código do servidor importa `cli-*`.
 */
import { aplicarMigracoes } from "./migrate";

aplicarMigracoes();
