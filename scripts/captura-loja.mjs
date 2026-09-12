#!/usr/bin/env node
/**
 * Fotografa a interface REAL da extensão no tamanho que a Chrome Web Store pede
 * (1280×800), carregando `extension/dist` num Chromium de verdade.
 *
 * Por que existe: a Loja exige pelo menos uma captura, e tirá-la à mão significa
 * carregar a extensão, achar a janela, enquadrar e redimensionar — toda vez que
 * um texto ou uma cor mudar. Aqui é um comando.
 *
 * O QUE ELE NÃO FAZ, DE PROPÓSITO: não inventa conteúdo. As telas que dependem
 * de uma chave de IA (a aula pronta, a Bancada cheia) não são simuladas com
 * texto de mentira — elas aparecem quando VOCÊ destrincha um vídeo com a sua
 * chave e roda `--ao-vivo`. Captura com dado fabricado é propaganda enganosa, e
 * a Loja trata como tal.
 *
 *   npx playwright install chromium     # só na primeira vez
 *   npm run build:ext
 *   node scripts/captura-loja.mjs       # telas de instalação limpa
 *   node scripts/captura-loja.mjs --ao-vivo
 *       abre o Chromium com a extensão carregada e ESPERA você mexer: coloque a
 *       chave, destrinche um vídeo, deixe na tela que quer fotografar e aperte
 *       ENTER aqui. A foto sai da janela como ela está.
 *
 * Saída: extension/pacote/capturas/*.png
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(raiz, "extension", "dist");
const saida = path.join(raiz, "extension", "pacote", "capturas");

/** Fundo da marca (BRAND.md, tema claro) — a moldura, não a interface. */
const FUNDO = "#F5F2EC";
const LARGURA = 1280;
const ALTURA = 800;

if (!fs.existsSync(dist)) {
  console.error("\n✖ extension/dist não existe — rode `npm run build:ext` antes.\n");
  process.exit(1);
}

/**
 * O ID de uma extensão sem pacote é derivado do caminho absoluto dela: sha-256
 * do caminho, 32 primeiros dígitos hexadecimais remapeados para a-p. É estável,
 * então dá para montar a URL `chrome-extension://<id>/...` sem perguntar ao
 * navegador — e este manifesto não tem service worker a quem perguntar.
 */
function idDaExtensao(caminho) {
  return crypto
    .createHash("sha256")
    .update(caminho)
    .digest("hex")
    .slice(0, 32)
    .replace(/[0-9a-f]/g, (c) => "abcdefghijklmnop"[parseInt(c, 16)]);
}

/**
 * Fotografa a página da extensão no tamanho real dela e centra a foto numa
 * folha 1280×800. A interface é a que o usuário vê; a folha só dá o
 * enquadramento que a Loja exige.
 *
 * Por que em dois passos, e não um `<iframe>`: página de extensão não é
 * `web_accessible_resource`, então o navegador RECUSA carregá-la dentro de um
 * frame — e recusa em silêncio, com um ícone de documento quebrado. A primeira
 * versão deste script fazia isso e produziu duas capturas de moldura vazia com
 * cara de captura boa. Foto de imagem não passa por essa barreira.
 */
async function moldurar(ctx, url, largura, altura) {
  const real = await ctx.newPage();
  await real.setViewportSize({ width: largura, height: altura });
  await real.goto(url, { waitUntil: "domcontentloaded" });
  // A página tem o próprio JS para rodar (lê o storage, pinta a lista de
  // provedores). Sem esta espera, a foto sai do esqueleto vazio.
  await real.waitForTimeout(1500);
  const png = (await real.screenshot()).toString("base64");
  await real.close();

  const folha = await ctx.newPage();
  await folha.setViewportSize({ width: LARGURA, height: ALTURA });
  await folha.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>
       html,body{margin:0;height:100%}
       body{background:${FUNDO};display:grid;place-items:center}
       img{border:1px solid #17140F;display:block}
     </style>
     <img src="data:image/png;base64,${png}">`,
  );
  await folha.waitForTimeout(300);
  return folha;
}

/**
 * Uma folha só de fundo é uma captura vazia. Conferimos que a foto tem mesmo
 * mais de uma cor antes de dar o arquivo por bom — foi exatamente assim que a
 * moldura quebrada passou despercebida na primeira tentativa.
 */
async function temConteudo(pg) {
  return pg.evaluate(async () => {
    const img = document.querySelector("img");
    if (!img || img.naturalWidth === 0) return false;
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const cores = new Set();
    for (let i = 0; i < d.length; i += 4 * 97) cores.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    return cores.size > 8;
  });
}

const aoVivo = process.argv.includes("--ao-vivo");
const id = idDaExtensao(dist);
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-perfil-"));

const ctx = await chromium.launchPersistentContext(perfil, {
  headless: false,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  viewport: { width: LARGURA, height: ALTURA },
});

fs.mkdirSync(saida, { recursive: true });

if (aoVivo) {
  const pg = await ctx.newPage();
  await pg.goto(`chrome-extension://${id}/popup/popup.html`);
  console.log(
    `\nChromium aberto com a extensão carregada.\n` +
      `Deixe na tela que você quer fotografar e volte aqui.\n`,
  );
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const nome = (await rl.question("nome do arquivo (sem .png) [ao-vivo]: ")).trim() || "ao-vivo";
  rl.close();
  const arq = path.join(saida, `${nome}.png`);
  await pg.screenshot({ path: arq });
  console.log(`\n✔ ${path.relative(raiz, arq)}\n`);
} else {
  /**
   * Só telas que uma instalação limpa realmente mostra. Nenhuma delas depende de
   * chave, de rede ou de mexer no DOM — é a extensão recém-instalada, como
   * qualquer pessoa a encontra no primeiro minuto.
   */
  const telas = [
    { nome: "opcoes", url: `chrome-extension://${id}/options/options.html`, w: 600, h: 700 },
    { nome: "popup-primeiro-uso", url: `chrome-extension://${id}/popup/popup.html`, w: 400, h: 560 },
  ];
  let falhas = 0;
  for (const t of telas) {
    const pg = await moldurar(ctx, t.url, t.w, t.h);
    const arq = path.join(saida, `${t.nome}.png`);
    await pg.screenshot({ path: arq });
    const ok = await temConteudo(pg);
    await pg.close();
    if (!ok) falhas++;
    console.log(`${ok ? "✔" : "✖"} ${path.relative(raiz, arq)} (${LARGURA}×${ALTURA})${ok ? "" : " — SAIU VAZIA"}`);
  }
  if (falhas) {
    console.error(`\n✖ ${falhas} captura(s) saíram vazias — não envie.\n`);
    await ctx.close();
    process.exit(1);
  }
  console.log(
    `\nEstas são as telas de instalação limpa. A captura que vende o produto — a\n` +
      `aula pronta — precisa da sua chave: rode \`node scripts/captura-loja.mjs --ao-vivo\`.\n`,
  );
}

await ctx.close();
fs.rmSync(perfil, { recursive: true, force: true });
