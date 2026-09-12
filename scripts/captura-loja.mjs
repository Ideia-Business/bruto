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

/**
 * Telas que o modo `--ao-vivo` se recusa a fotografar, porque a chave da pessoa
 * aparece nelas. Vale só ao vivo: no modo padrão o perfil é recém-criado e não
 * existe chave nenhuma para vazar — é justamente por isso que a tela de opções
 * limpa serve de peça para a listagem.
 */
const ALVO_PROIBIDO = /\/options\//;

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

/**
 * Nome de arquivo vindo do terminal é entrada não-confiável: `../../../id_rsa`
 * escreveria um PNG fora daqui. Fica só o nome-base, com um alfabeto fechado, e
 * o caminho resolvido é conferido contra a pasta de saída antes de gravar —
 * defesa em profundidade, porque uma das duas pode falhar sozinha.
 */
function arquivoSeguro(bruto) {
  const base = path
    .basename(String(bruto))
    .replace(/\.png$/i, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .toLowerCase();
  if (base === "") return null;
  const destino = path.resolve(saida, `${base}.png`);
  if (path.dirname(destino) !== path.resolve(saida)) return null;
  return destino;
}

const aoVivo = process.argv.includes("--ao-vivo");
const id = idDaExtensao(dist);

/**
 * O PERFIL É O ARQUIVO SENSÍVEL DESTE SCRIPT. No modo `--ao-vivo` ele guarda o
 * `chrome.storage.local` da extensão — ou seja, a chave de IA que você acabou
 * de colar. Se o processo morrer sem apagá-lo, a chave fica num diretório
 * temporário, viva, à espera de quem passar por lá.
 *
 * Por isso a remoção acontece em `finally` E nos sinais: Ctrl-C manda SIGINT, o
 * `finally` não roda, e a versão anterior deste script vazava exatamente aí.
 * `mkdtemp` já cria o diretório como 0700 — o `chmod` explícito existe para que
 * isso seja uma decisão, não uma herança de plataforma.
 */
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-perfil-"));
fs.chmodSync(perfil, 0o700);

let ctx = null;

/**
 * Apagar não basta: **o navegador tem de morrer primeiro.** Medido nesta lane —
 * a primeira versão do conserto apagava o perfil direto no handler de sinal, e
 * o Chromium, ainda vivo e com os arquivos abertos, RECRIAVA o diretório ao
 * descer. Sobrava um perfil órfão com cara de bug aleatório. Por isso a ordem é
 * fechar o contexto e só então remover — e conferir, porque a corrida pode
 * ainda assim recriar o diretório.
 */
function limpar() {
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      fs.rmSync(perfil, { recursive: true, force: true });
      if (!fs.existsSync(perfil)) return true;
    } catch {
      // segue para a próxima tentativa
    }
    // Espera curta e ocupada de propósito: isto também roda em handler de sinal,
    // onde não dá para aguardar uma promessa antes de o processo sair.
    const ate = Date.now() + 250;
    while (Date.now() < ate) {
      /* aguarda o navegador soltar os arquivos */
    }
  }
  console.error(
    `\n⚠  não consegui apagar o perfil: ${perfil}\n` +
      `   APAGUE À MÃO — ele pode conter a sua chave de IA.\n`,
  );
  return false;
}

/** Fecha o navegador (com teto de tempo) e só então limpa. */
async function encerrar(codigo) {
  if (ctx !== null) {
    const ctxLocal = ctx;
    ctx = null;
    await Promise.race([
      ctxLocal.close().catch(() => {}),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
  }
  limpar();
  process.exit(codigo);
}

for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => {
    void encerrar(130);
  });
}

try {
  ctx = await chromium.launchPersistentContext(perfil, {
    headless: false,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    viewport: { width: LARGURA, height: ALTURA },
    // O Playwright instala os PRÓPRIOS handlers de sinal, que fecham o navegador
    // e chamam `process.exit(130)` — antes de a limpeza daqui terminar. Foi o que
    // aconteceu: o Ctrl-C saía com 130, sem apagar nada e sem nem avisar, e o
    // perfil com a chave ficava no disco. Quem manda no encerramento é este
    // script, porque é ele que sabe que há um segredo para apagar.
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });

  fs.mkdirSync(saida, { recursive: true });

  if (aoVivo) {
    /**
     * A PEGADINHA que este modo existe para contornar: a página do popup aberta
     * como aba NÃO consegue destrinchar. Ela pergunta qual é a aba ativa, a
     * resposta é ela mesma, e cai na tela "isto não é um vídeo do YouTube". A
     * primeira versão daqui abria essa página e prometia a captura da aula — que
     * por ali não aparece nunca.
     *
     * O caminho que funciona passa pela Bancada: você destrincha pelo popup de
     * verdade (o do ícone na barra, que nenhum script consegue fotografar porque
     * é interface do navegador, não página), a aula fica guardada, e a página do
     * popup em aba mostra essa MESMA aula pela Bancada. A foto sai de conteúdo de
     * página, e a aula nela é real — feita com a sua chave, do vídeo que você
     * escolheu.
     */
    const yt = await ctx.newPage();
    await yt.goto("https://www.youtube.com", { waitUntil: "domcontentloaded" }).catch(() => {});
    const pgPopup = await ctx.newPage();
    await pgPopup.goto(`chrome-extension://${id}/options/options.html`);

    console.log(
      `\nChromium aberto com a extensão carregada. O caminho, na ordem:\n\n` +
        `  1. na aba de opções, escolha o provedor e cole a sua chave;\n` +
        `  2. vá para a aba do YouTube, abra um vídeo e clique no ÍCONE do Bruto\n` +
        `     na barra do navegador — é ali que se destrincha;\n` +
        `  3. volte para a aba de opções e abra  chrome-extension://${id}/popup/popup.html\n` +
        `     (ou recarregue, se já estiver nela). Clique em Bancada e abra a aula;\n` +
        `  4. deixe a aula na tela, na frente, e volte aqui.\n\n` +
        `  A aba de OPÇÕES mostra a sua chave, então eu me RECUSO a fotografá-la:\n` +
        `  se ela estiver na frente na hora do disparo, nada é gravado e eu digo\n` +
        `  o porquê. Deixe a aula na frente.\n`,
    );

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const resposta = (await rl.question("nome do arquivo (sem .png) [aula]: ")).trim();
    rl.close();

    const arq = arquivoSeguro(resposta === "" ? "aula" : resposta);
    if (arq === null) {
      console.error(`\n✖ nome de arquivo recusado — use letras, números, hífen ou sublinhado.\n`);
      process.exitCode = 1;
    } else {
      // Fotografa a aba que VOCÊ deixou na frente, não uma escolhida aqui: o passo
      // 3 acima pode terminar em qualquer página da extensão.
      const visiveis = [];
      for (const p of ctx.pages()) {
        if (p.isClosed()) continue;
        const v = await p.evaluate(() => document.visibilityState === "visible").catch(() => false);
        if (v) visiveis.push(p);
      }
      const alvo = visiveis.at(-1) ?? pgPopup;

      /**
       * RECUSA, e não aviso. A tela de opções tem o campo da chave, e o botão
       * "Mostrar" a revela — deixá-la na frente gravaria a chave num PNG dentro
       * de `capturas/`, que é justamente a pasta de onde saem as imagens que
       * sobem para a Loja. A versão anterior fotografava e avisava DEPOIS: aviso
       * posterior não desfaz arquivo gravado, e quem não lê o terminal publica.
       *
       * Mascarar o campo antes do disparo seria a alternativa; foi descartada
       * porque depende de acertar um seletor, e seletor quebra calado — o modo
       * de falha voltaria a ser a chave no PNG, só que sem ninguém saber.
       *
       * É a ÚNICA tela da extensão onde a chave aparece: o popup nunca a mostra
       * (confirmado no código; ele só a usa) e a aula não a contém.
       */
      if (ALVO_PROIBIDO.test(alvo.url())) {
        console.error(
          `\n✖ não fotografei: a tela na frente é a de OPÇÕES, onde a sua chave aparece.\n` +
            `   Um PNG dessa tela pode carregar a chave para dentro de capturas/, que é\n` +
            `   de onde saem as imagens da Loja.\n\n` +
            `   Deixe na frente a aula (pela Bancada) e rode de novo.\n`,
        );
        process.exitCode = 1;
      } else {
        await alvo.setViewportSize({ width: LARGURA, height: ALTURA });
        await alvo.screenshot({ path: arq });
        console.log(`\n✔ ${path.relative(raiz, arq)} (${LARGURA}×${ALTURA})\n`);
      }
    }
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
      // Sai pelo `finally`: `process.exit` aqui pularia a limpeza do perfil.
      process.exitCode = 1;
    } else {
      console.log(
        `\nEstas são as telas de instalação limpa. A captura que vende o produto — a\n` +
          `aula pronta — precisa da sua chave: rode \`node scripts/captura-loja.mjs --ao-vivo\`.\n`,
      );
    }
  }
} finally {
  if (ctx !== null) {
    const ctxLocal = ctx;
    ctx = null;
    await ctxLocal.close().catch(() => {});
  }
  limpar();
}
