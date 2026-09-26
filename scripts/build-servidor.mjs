/**
 * Empacota o servidor do modo grátis (`servidor/api/*.ts`) num payload
 * autocontido em `servidor/.payload/` — é essa pasta, e só ela, que
 * `vercel-deploy-isolado` recebe para publicar o projeto `bruto-gratis`.
 *
 * Por que bundle e não `tsc` + `node_modules`: o payload isolado
 * (`vercel-deploy-isolado`) não carrega o `node_modules` de 671 pacotes deste
 * monorepo — só o que está dentro do diretório publicado. `esbuild` resolve os
 * imports (inclusive `../../src/pipeline/prompts/study`, que fica FORA de
 * `servidor/`, e o pacote `@upstash/redis`) e escreve tudo num arquivo por
 * rota. Nenhum import de `node:*` é agrupado — `platform: "node"` os deixa
 * externos, porque o runtime da Vercel já os fornece.
 *
 *   node scripts/build-servidor.mjs
 *
 * Saída: servidor/.payload/{api/aula.js, api/cota.js, package.json, vercel.json}
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origemServidor = path.join(raiz, "servidor");
const destino = path.join(origemServidor, ".payload");

async function main() {
  fs.rmSync(destino, { recursive: true, force: true });

  await build({
    entryPoints: {
      "api/aula": path.join(origemServidor, "api/aula.ts"),
      "api/cota": path.join(origemServidor, "api/cota.ts"),
    },
    outdir: destino,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    // Sem minificação: mesmo raciocínio do build da extensão — quem publica
    // (o dono, via vercel-deploy-isolado) deve conseguir ler o que sobe.
    minify: false,
    sourcemap: false,
    logLevel: "info",
  });

  // Gate 1 — os dois handlers saíram do build e não estão vazios.
  const handlers = ["api/aula.js", "api/cota.js"];
  const handlersAusentes = handlers.filter((f) => {
    const p = path.join(destino, f);
    return !fs.existsSync(p) || fs.statSync(p).size === 0;
  });
  if (handlersAusentes.length > 0) {
    console.error(`\n✖ build incompleto — faltam: ${handlersAusentes.join(", ")}`);
    process.exit(1);
  }

  // Gate 2 — nenhum handler carrega a chave ou outro segredo LITERAL. O código
  // só referencia `process.env.OLLAMA_API_KEY` (leitura em runtime); esbuild
  // não inlina env vars sem `define` explícito, e este build não o usa — mas
  // o gate prova isso, em vez de confiar em "não deveria acontecer".
  const padroesProibidos = [/OLLAMA_API_KEY\s*=\s*["'`]/, /BRUTO_SAL\s*=\s*["'`]/];
  for (const arquivo of handlers) {
    const conteudo = fs.readFileSync(path.join(destino, arquivo), "utf8");
    for (const padrao of padroesProibidos) {
      if (padrao.test(conteudo)) {
        console.error(`\n✖ build suspeito — ${arquivo} contém um valor literal de segredo (padrão ${padrao}).`);
        process.exit(1);
      }
    }
  }

  // package.json mínimo do payload — `"type": "module"` é o que faz o Node
  // (e a Vercel) tratar os `.js` gerados como ESM sem precisar de `.mjs`.
  fs.writeFileSync(
    path.join(destino, "package.json"),
    JSON.stringify({ name: "bruto-gratis", private: true, type: "module" }, null, 2) + "\n",
  );

  // O mesmo vercel.json que rege `maxDuration` das funções.
  fs.copyFileSync(path.join(origemServidor, "vercel.json"), path.join(destino, "vercel.json"));

  // Gate 3 — o payload inteiro tem os quatro arquivos que a Vercel precisa.
  const exigidos = [...handlers, "package.json", "vercel.json"];
  const ausentes = exigidos.filter((f) => {
    const p = path.join(destino, f);
    return !fs.existsSync(p) || fs.statSync(p).size === 0;
  });
  if (ausentes.length > 0) {
    console.error(`\n✖ payload incompleto — faltam: ${ausentes.join(", ")}`);
    process.exit(1);
  }

  console.log(`\n✔ servidor empacotado em ${path.relative(raiz, destino)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
