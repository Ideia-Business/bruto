/**
 * Gera as imagens de marca do repositório a partir de `assets/banner.html`.
 *
 *   node scripts/build-assets.mjs
 *
 * Saída: `assets/banner-claro.png` e `assets/banner-escuro.png`, em 2x — o
 * GitHub serve a imagem no dobro da densidade em tela retina, e banner
 * borrado no topo do README é pior do que banner nenhum.
 *
 * Os PNGs SÃO versionados, ao contrário de `extension/dist/`. Parece
 * contraditório versionar artefato de build, mas aqui é o oposto do que
 * parece: o GitHub renderiza o README direto do repositório, sem rodar nada.
 * Se a imagem não estiver commitada, ninguém a vê.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origem = path.join(raiz, "assets", "banner.html");
const ESCALA = 2;

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("✖ playwright ausente. Rode: npm install && npx playwright install chromium");
    process.exit(1);
  }

  const navegador = await chromium.launch();
  try {
    for (const tema of ["claro", "escuro"]) {
      const pagina = await navegador.newPage({
        viewport: { width: 1100, height: 330 },
        deviceScaleFactor: ESCALA,
      });

      await pagina.goto(`file://${origem}`, { waitUntil: "load" });
      await pagina.evaluate((t) => {
        document.documentElement.setAttribute("data-tema", t);
      }, tema);

      // As fontes vêm do Google Fonts; sem esperar, o banner sai com a
      // fonte de fallback e a diferença é gritante no wordmark.
      await pagina.evaluate(() => document.fonts.ready);
      await pagina.waitForTimeout(400);

      const saida = path.join(raiz, "assets", `banner-${tema}.png`);
      await pagina.screenshot({ path: saida });
      await pagina.close();

      const kb = Math.round(fs.statSync(saida).size / 1024);
      console.log(`  ${path.relative(raiz, saida)}  ${kb} KB`);
    }
  } finally {
    await navegador.close();
  }

  // Gate: imagem vazia quebraria o README em silêncio.
  for (const tema of ["claro", "escuro"]) {
    const p = path.join(raiz, "assets", `banner-${tema}.png`);
    if (!fs.existsSync(p) || fs.statSync(p).size < 5000) {
      console.error(`✖ ${path.relative(raiz, p)} saiu vazio ou pequeno demais`);
      process.exit(1);
    }
  }

  console.log("\n✔ banners gerados");
  console.log(
    "  Dica: assets/banner-claro.png serve como social preview do repositório\n" +
      "  (Settings → General → Social preview), que é o card exibido quando\n" +
      "  alguém compartilha o link. Passo manual, o GitHub não expõe por API.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
