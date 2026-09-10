/**
 * Empacota a extensão do navegador.
 *
 * Por que existe um build aqui, num projeto que evita ferramenta: é ele que
 * permite a extensão IMPORTAR os prompts de `src/pipeline/prompts/` — a mesma
 * fonte que o app Node usa. A alternativa seria uma segunda cópia dos prompts,
 * e duas cópias divergem: a extensão passaria a resumir diferente do app sem
 * ninguém perceber. Os prompts são puros (nenhum import de `node:`), então
 * atravessam para o navegador sem adaptação.
 *
 *   node scripts/build-extension.mjs [--watch]
 *
 * Saída: extension/dist/ — é essa pasta que se carrega em
 * chrome://extensions (Modo do desenvolvedor → Carregar sem compactação).
 */

import { build, context } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origem = path.join(raiz, "extension");
const destino = path.join(origem, "dist");

const watch = process.argv.includes("--watch");

/** Copia um arquivo criando o diretório de destino. */
function copiar(de, para) {
  fs.mkdirSync(path.dirname(para), { recursive: true });
  fs.copyFileSync(de, para);
}

/** Ícones PNG a partir do SVG, usando o Chromium que o projeto já baixou. */
async function gerarIcones() {
  const svgPath = path.join(origem, "icon.svg");
  const alvos = [16, 32, 128];
  const faltando = alvos.filter(
    (n) => !fs.existsSync(path.join(destino, "icons", `${n}.png`)),
  );
  if (faltando.length === 0) return { ok: true, msg: "ícones já gerados" };

  // Ícone é cosmético: a extensão carrega sem ele (o Chrome usa um genérico).
  // Por isso NADA aqui pode derrubar o build — nem o pacote ausente, nem o
  // Chromium não baixado, que é o caso comum em clone novo antes do
  // `npx playwright install`.
  let navegador;
  try {
    const { chromium } = await import("playwright");
    const svg = fs.readFileSync(svgPath, "utf8");
    navegador = await chromium.launch();
    for (const n of alvos) {
      const pagina = await navegador.newPage({ viewport: { width: n, height: n } });
      await pagina.setContent(
        `<!doctype html><html><body style="margin:0">${svg.replace(
          /width="128" height="128"/,
          `width="${n}" height="${n}"`,
        )}</body></html>`,
        { waitUntil: "load" },
      );
      const saida = path.join(destino, "icons", `${n}.png`);
      fs.mkdirSync(path.dirname(saida), { recursive: true });
      await pagina.locator("svg").screenshot({ path: saida });
      await pagina.close();
    }
    return { ok: true, msg: `ícones gerados: ${alvos.join(", ")}px` };
  } catch {
    return {
      ok: false,
      msg: "ícones não gerados (rode `npx playwright install chromium` se quiser o ícone próprio) — a extensão carrega sem eles",
    };
  } finally {
    if (navegador) await navegador.close().catch(() => {});
  }
}

/**
 * manifest + html + css.
 *
 * O manifest é copiado com uma ressalva: se os ícones não foram gerados, as
 * entradas que apontam para eles são REMOVIDAS. O Chrome recusa carregar um
 * manifest que referencia arquivo inexistente — deixar as entradas quebraria a
 * extensão inteira por causa de um PNG cosmético.
 */
function copiarEstaticos({ comIcones }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(origem, "manifest.json"), "utf8"));
  if (!comIcones) {
    delete manifest.icons;
    if (manifest.action) delete manifest.action.default_icon;
  }
  fs.mkdirSync(destino, { recursive: true });
  fs.writeFileSync(path.join(destino, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  // Os HTML são escritos com os caminhos da ÁRVORE DE FONTES — onde o CSS está
  // um nível acima (`../ui.css`) e o script ainda é `.ts`. No `dist` o layout é
  // plano por página e o script já virou `.js`. Reescrever aqui mantém as duas
  // pontas honestas: o fonte abre no editor sem link quebrado, e o empacotado
  // aponta para o que existe de fato.
  for (const [de, para] of [
    ["src/popup/popup.html", "popup/popup.html"],
    ["src/options/options.html", "options/options.html"],
  ]) {
    const html = fs
      .readFileSync(path.join(origem, de), "utf8")
      .replace(/href="\.\.\/ui\.css"/g, 'href="./ui.css"')
      .replace(/src="\.\/([\w-]+)\.ts"/g, 'src="./$1.js"');
    const alvo = path.join(destino, para);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, html);
  }

  // O CSS é um só, compartilhado — cada página recebe a sua cópia ao lado.
  const css = path.join(origem, "src/ui.css");
  copiar(css, path.join(destino, "popup/ui.css"));
  copiar(css, path.join(destino, "options/ui.css"));
}

const comum = {
  outdir: destino,
  bundle: true,
  target: "chrome120",
  platform: "browser",
  // Sem minificação: é uma extensão de código aberto, e quem instala deve
  // conseguir ler o que está rodando na própria máquina.
  minify: false,
  sourcemap: true,
  logLevel: "info",
};

/** Páginas da extensão (popup e opções) — carregadas por <script type="module">. */
const opcoesPaginas = {
  ...comum,
  entryPoints: {
    "popup/popup": path.join(origem, "src/popup/popup.ts"),
    "options/options": path.join(origem, "src/options/options.ts"),
  },
  format: "esm",
};

/**
 * Content script — build SEPARADO porque o formato precisa ser outro.
 * `chrome.scripting.executeScript({ files })` não carrega módulo ES; o arquivo
 * tem de ser autocontido. Daí IIFE, e daí duas chamadas ao esbuild em vez de
 * uma (o formato é global por build, não por entry point).
 */
const opcoesContent = {
  ...comum,
  entryPoints: { "content/captura": path.join(origem, "src/content/captura-content.ts") },
  format: "iife",
};

async function main() {
  fs.rmSync(destino, { recursive: true, force: true });

  if (watch) {
    const ctx = await context(opcoesPaginas);
    const ctxContent = await context(opcoesContent);
    const ic = await gerarIcones();
    copiarEstaticos({ comIcones: ic.ok });
    console.log(ic.msg);
    await ctx.watch();
    await ctxContent.watch();
    console.log("observando… (Ctrl+C encerra)");
    return;
  }

  await build(opcoesPaginas);
  await build(opcoesContent);
  const ic = await gerarIcones();
  copiarEstaticos({ comIcones: ic.ok });
  console.log(ic.msg);

  // Gate: o que o Chrome exige para carregar precisa existir de fato.
  const exigidos = [
    "manifest.json",
    "popup/popup.html",
    "popup/popup.js",
    "popup/ui.css",
    "options/options.html",
    "options/options.js",
    "content/captura.js",
  ];
  const ausentes = exigidos.filter((f) => {
    const p = path.join(destino, f);
    return !fs.existsSync(p) || fs.statSync(p).size === 0;
  });
  if (ausentes.length > 0) {
    console.error(`\n✖ build incompleto — faltam: ${ausentes.join(", ")}`);
    process.exit(1);
  }

  console.log(`\n✔ extensão em ${path.relative(raiz, destino)}`);
  console.log("  Chrome → chrome://extensions → Modo do desenvolvedor → Carregar sem compactação");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
