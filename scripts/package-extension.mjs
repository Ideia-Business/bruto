#!/usr/bin/env node
/**
 * Empacota `extension/dist` no .zip que a Chrome Web Store aceita.
 *
 * Por que um script e não um `zip -r` na mão: a Loja rejeita o pacote por
 * detalhes que não dão erro nenhum localmente — arquivo de mapa de código
 * sobrando, ícone faltando, versão do manifesto diferente da do projeto. Cada
 * rejeição custa uma revisão inteira de espera, então a conferência acontece
 * ANTES do envio, aqui, com exit code.
 *
 * Os `.map` são deliberadamente excluídos: servem para depurar, pesam, e na
 * Loja viram código-fonte publicado sem propósito. O código é aberto de
 * qualquer forma — quem quiser auditar lê o repositório, não o sourcemap.
 *
 *   node scripts/package-extension.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(raiz, "extension", "dist");
const saidaDir = path.join(raiz, "extension", "pacote");

/**
 * O esqueleto que sempre tem de existir. Os ÍCONES não estão aqui de propósito:
 * quando o Chromium não está disponível, o build gera a extensão sem eles E os
 * remove do manifesto (`scripts/build-extension.mjs`). Exigir os PNG por lista
 * fixa faria o CI, que não baixa Chromium, reprovar um pacote correto.
 *
 * A conferência de ícones é feita contra o que o MANIFESTO declara — se ele
 * promete um ícone, o arquivo tem de estar lá. É a pergunta certa: o pacote é
 * internamente coerente?
 */
const OBRIGATORIOS = [
  "manifest.json",
  "popup/popup.html",
  "popup/popup.js",
  "popup/ui.css",
  "options/options.html",
  "options/options.js",
  "content/captura.js",
];

function morrer(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(dist)) morrer("extension/dist não existe — rode `npm run build:ext` antes.");

// ── 1. o pacote tem tudo que a Loja exige? ───────────────────────────────────
const faltando = OBRIGATORIOS.filter((f) => {
  try {
    return fs.statSync(path.join(dist, f)).size === 0;
  } catch {
    return true;
  }
});
if (faltando.length) morrer(`faltam arquivos no pacote:\n   ${faltando.join("\n   ")}`);

// ── 2. a versão do manifesto bate com a do projeto? ──────────────────────────
// Divergir aqui é o erro que passa despercebido: sobe-se um pacote "novo" com
// o número antigo, e a Loja o recusa por versão não incrementada.
const manifesto = JSON.parse(fs.readFileSync(path.join(dist, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(raiz, "package.json"), "utf8"));
if (manifesto.version !== pkg.version) {
  morrer(
    `versão divergente: manifest.json diz ${manifesto.version}, package.json diz ${pkg.version}.\n` +
      `   A Loja exige que cada envio tenha versão maior que o anterior.`,
  );
}

// ── 2b. o manifesto cumpre o que promete em ícone? ───────────────────────────
const iconesDeclarados = [
  ...Object.values(manifesto.icons || {}),
  ...Object.values(manifesto.action?.default_icon || {}),
];
const iconesFaltando = [...new Set(iconesDeclarados)].filter((f) => {
  try {
    return fs.statSync(path.join(dist, f)).size === 0;
  } catch {
    return true;
  }
});
if (iconesFaltando.length) {
  morrer(`o manifesto declara ícones que não estão no pacote:\n   ${iconesFaltando.join("\n   ")}`);
}
/** Sem ícone nenhum o pacote CARREGA, mas a Loja não o aceita. Avisa alto. */
const semIcones = iconesDeclarados.length === 0;

// ── 3. limites de texto da própria Loja ──────────────────────────────────────
if ((manifesto.name || "").length > 75) morrer("`name` do manifesto passa de 75 caracteres.");
if ((manifesto.description || "").length > 132) {
  morrer(`\`description\` tem ${manifesto.description.length} caracteres; o teto da Loja é 132.`);
}

// ── 4. nada de código remoto ─────────────────────────────────────────────────
// A Loja rejeita extensão que baixa e executa script de fora. Não fazemos isso;
// esta checagem existe para que ninguém passe a fazer sem perceber.
const remoto = [];
for (const arq of listar(dist)) {
  if (!/\.(html|js)$/.test(arq)) continue;
  const txt = fs.readFileSync(arq, "utf8");
  if (/<script[^>]+src=["']https?:/i.test(txt)) remoto.push(path.relative(dist, arq));
}
if (remoto.length) morrer(`script remoto referenciado (a Loja proíbe):\n   ${remoto.join("\n   ")}`);

// ── 5. zip, sem sourcemap ────────────────────────────────────────────────────
fs.mkdirSync(saidaDir, { recursive: true });
const zip = path.join(saidaDir, `bruto-${manifesto.version}.zip`);
fs.rmSync(zip, { force: true });
execFileSync("zip", ["-q", "-r", "-X", zip, ".", "-x", "*.map", "-x", ".*"], { cwd: dist });

const kb = (fs.statSync(zip).size / 1024).toFixed(0);
console.log(`\n✔ pacote pronto: ${path.relative(raiz, zip)} (${kb} KB)`);
console.log(`  versão ${manifesto.version} · estrutura, versão, limites de texto e código remoto conferidos`);
if (semIcones) {
  console.log(
    `\n⚠  SEM ÍCONES — este pacote NÃO serve para a Loja.\n` +
      `   O build só gera os PNG com o Chromium do Playwright. Para o pacote de envio:\n` +
      `   npx playwright install chromium && npm run package:ext`,
  );
} else {
  console.log(`  envie em https://chrome.google.com/webstore/devconsole`);
}
console.log("");

function* listar(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* listar(p);
    else yield p;
  }
}
