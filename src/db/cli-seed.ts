/**
 * Entrypoint de CLI do seed (`npm run db:seed`).
 *
 * Separado de `seed.ts` pelo mesmo motivo de `cli-migrate.ts` (ver o
 * comentário dele): o gatilho `import.meta.url`/`realpathSync(argv[1])`
 * arrastava a toolchain do build para o payload do standalone. `seed.ts` só
 * exporta `aplicarSeed()`; este arquivo só é executado.
 */
import { aplicarSeed } from "./seed";

aplicarSeed();
