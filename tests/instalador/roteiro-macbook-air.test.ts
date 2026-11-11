/**
 * `scripts/instalador-macos/roteiro-macbook-air.sh` — o roteiro da prova do
 * .dmg do Bruto, que a partir de 11/11/2026 é SOMENTE LEITURA (decisão do
 * dono, depois de três rodadas do Codex com achados de segurança: testar
 * aprovando o que não provou; identificar processo para matar; restaurar
 * movendo caminho arbitrário de um registro adulterado). O script nunca
 * move, apaga, renomeia, cria (fora do relatório na Mesa) nem envia sinal a
 * nada; limpar e desfazer o teste viraram passos MANUAIS no documento
 * (docs/instalador/roteiro-macbook-air.md, passos 2 e 5).
 *
 * Aqui o script roda com HOME temporário, itens falsos e binários falsos
 * (`lsof`, `ps`, `open`, `curl`) na frente do PATH; a porta NUNCA é a 3000
 * (`BRUTO_ROTEIRO_PORTA` aponta para uma porta livre de verdade) e o tempo
 * de espera é injetado (`BRUTO_ROTEIRO_ESPERA`). O `~/.bruto` da pessoa
 * nunca é tocado.
 *
 * Cobertura (briefing da rodada 5):
 * - (a) o script não contém `mv `, `rm `, `kill`, `pkill`, `killall`, `ln `,
 *   `cp `, `mktemp` nem redirecionamento de escrita fora do arquivo de
 *   relatório da Mesa (grep) — e a palavra "aprovado" não existe nele: o
 *   roteiro não decide resultado nenhum.
 * - (b) `listar` com HOME temporário e itens falsos não altera nada
 *   (snapshot antes/depois, inclusive mtime dos arquivos) e gera o relatório.
 * - (c) `testar` com `open` e `curl` falsos imprime o corpo bruto e a versão
 *   do Info.plist, mais o fim do log do servidor (últimas 20 linhas) — e NÃO
 *   contém a palavra "aprovado"; exit 0 quando coleta, ≠ 0 quando não
 *   consegue nem coletar (com o motivo).
 * - (d) os subcomandos antigos (`limpar`, `restaurar`) respondem "não existe
 *   mais — veja docs/instalador/roteiro-macbook-air.md" com exit ≠ 0.
 *
 * Cobertura (briefing da rodada 6):
 * - (e) no DOCUMENTO (docs/instalador/roteiro-macbook-air.md), toda linha com
 *   `mv ` é protegida: começa com a guarda `[ -e … ]` e contém
 *   `echo "PARE:` — porque `mv origem destino`, com destino PASTA que já
 *   existe, não dá erro nenhum: move a origem PARA DENTRO do destino, em
 *   silêncio (achado da 4ª rodada do Codex sobre o rollback). O aviso "se o
 *   mv disser que o destino existe, PARE" nunca dispararia.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROTEIRO = path.join(RAIZ, "scripts", "instalador-macos", "roteiro-macbook-air.sh");
const DOCUMENTO = path.join(RAIZ, "docs", "instalador", "roteiro-macbook-air.md");
const ARQUIVO_HOST = "com.ideiabusiness.bruto.json";

interface Cenario {
  tmp: string;
  home: string;
  clone: string;
  appUsuario: string;
  appSistema: string;
  dados: string;
  manifestos: string[];
  logServidor: string;
  env: NodeJS.ProcessEnv;
  limpar: () => void;
}

/** Portas que o teste JAMAIS usa: a da pessoa (3000) e as de dev (3556/3559). */
const PORTAS_PROIBIDAS = new Set([3000, 3556, 3559]);

function portaLivre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const tentar = (): void => {
      const s = net.createServer();
      s.listen(0, "127.0.0.1", () => {
        const p = (s.address() as net.AddressInfo).port;
        s.close(() => (PORTAS_PROIBIDAS.has(p) ? tentar() : resolve(p)));
      });
      s.on("error", reject);
    };
    tentar();
  });
}

function escreverExecutavel(caminho: string, conteudo: string): void {
  fs.writeFileSync(caminho, conteudo, { mode: 0o755 });
}

/** Monta o Air falso: itens do Bruto em HOME temporário + lsof/ps/open/curl falsos. */
async function montar(): Promise<Cenario> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bruto-roteiro-"));
  const home = path.join(tmp, "home");
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(bin, { recursive: true });
  const clone = path.join(home, "Bruto");
  const appUsuario = path.join(home, "Applications", "Bruto.app");
  const appSistema = path.join(tmp, "appSistema", "Bruto.app");
  const dados = path.join(home, ".bruto");

  fs.mkdirSync(path.join(home, "Desktop"), { recursive: true });
  fs.mkdirSync(path.join(clone, "launcher"), { recursive: true });
  fs.writeFileSync(path.join(clone, "launcher", "serve.sh"), "# antigo\n");
  fs.writeFileSync(path.join(clone, ".env"), "CHAVE=teste-nao-e-segredo\n");
  fs.mkdirSync(path.join(appUsuario, "Contents", "MacOS"), { recursive: true });
  escreverExecutavel(path.join(appUsuario, "Contents", "MacOS", "Bruto"), "# app do usuário\n");
  fs.mkdirSync(path.dirname(appSistema), { recursive: true });
  fs.mkdirSync(path.join(appSistema, "Contents", "MacOS"), { recursive: true });
  escreverExecutavel(path.join(appSistema, "Contents", "MacOS", "Bruto"), "# app do sistema\n");
  fs.mkdirSync(path.join(dados, "library"), { recursive: true });
  fs.writeFileSync(path.join(dados, "library", "item.txt"), "vídeo da pessoa");
  fs.mkdirSync(path.join(dados, "ferramentas"), { recursive: true });

  // Log do servidor com 30 linhas numeradas: o relatório do `testar` tem de
  // trazer SÓ as últimas 20 (log-linha-11..30), nunca o arquivo inteiro.
  const logServidor = path.join(dados, "logs", "servidor.log");
  fs.mkdirSync(path.dirname(logServidor), { recursive: true });
  const linhas = Array.from({ length: 30 }, (_, i) => `log-linha-${String(i + 1).padStart(2, "0")} servidor`);
  fs.writeFileSync(logServidor, `${linhas.join("\n")}\n`);

  const base = path.join(home, "Library", "Application Support");
  const manifestos = ["Google/Chrome", "Microsoft Edge"].map((navegador) => {
    const alvo = path.join(base, navegador, "NativeMessagingHosts", `${ARQUIVO_HOST}`);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, `{"name":"com.ideiabusiness.bruto","path":"/um/caminho"}\n`);
    return alvo;
  });

  // lsof falso: só a sonda DA PORTA (-iTCP…) é controlada pelo teste (devolve
  // FALSO_PID); qualquer outra chamada vai para o lsof REAL.
  escreverExecutavel(
    path.join(bin, "lsof"),
    [
      "#!/bin/bash",
      'for a in "$@"; do',
      "  case \"$a\" in",
      "    -iTCP:*)",
      '      if [ -n "${FALSO_PID:-}" ]; then printf \'p%s\\n\' "$FALSO_PID"; fi',
      "      exit 0",
      "      ;;",
      "  esac",
      "done",
      'exec /usr/sbin/lsof "$@"',
      "",
    ].join("\n"),
  );
  // ps falso: o comando do PID vê o que o teste puser em FALSO_CMD. Não dá
  // para delegar ao /bin/ps: exec aninhado dele é bloqueado no ambiente de
  // teste (EPERM) — e o que está sob prova é a informação, não o ps.
  escreverExecutavel(
    path.join(bin, "ps"),
    '#!/bin/bash\nprintf \'%s\\n\' "${FALSO_CMD:-}"\nexit 0\n',
  );
  // open falso: o testar JAMAIS abre nada de verdade na máquina do teste.
  escreverExecutavel(path.join(bin, "open"), "#!/bin/bash\nexit 0\n");
  // curl falso: responde na hora o que o teste puser em FALSO_CORPO (vazio =
  // "sem resposta" — o loop de espera do roteiro honra BRUTO_ROTEIRO_ESPERA,
  // então o caso "não coletou" é rápido e determinístico).
  escreverExecutavel(
    path.join(bin, "curl"),
    '#!/bin/bash\nprintf \'%s\\n\' "${FALSO_CORPO:-}"\nexit 0\n',
  );

  // Info.plist REAL no app falso: o testar imprime a versão lida com o
  // PlistBuddy de verdade.
  fs.writeFileSync(
    path.join(appSistema, "Contents", "Info.plist"),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      "<dict>",
      "\t<key>CFBundleShortVersionString</key>",
      "\t<string>9.9.9</string>",
      "</dict>",
      "</plist>",
      "",
    ].join("\n"),
  );

  const porta = await portaLivre();
  const cenario: Cenario = {
    tmp,
    home,
    clone,
    appUsuario,
    appSistema,
    dados,
    manifestos,
    logServidor,
    // Env construído do zero: nada do ambiente da máquina vaza para o teste.
    // NODE_ENV é constante do teste (padrão dos outros testes de instalador)
    // porque o ProcessEnv aumentado pelo Next o exige na tipagem do spawn.
    env: {
      HOME: home,
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
      NODE_ENV: "test",
      BRUTO_ROTEIRO_PORTA: String(porta),
      BRUTO_ROTEIRO_APP_SISTEMA: appSistema,
    },
    limpar: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
  return cenario;
}

interface Retorno {
  rc: number | null;
  out: string;
}

function rodar(c: Cenario, args: string[], stdin: string, extra: Record<string, string> = {}): Promise<Retorno> {
  return new Promise((resolve, reject) => {
    const filho: ChildProcessWithoutNullStreams = spawn("/bin/bash", [ROTEIRO, ...args], {
      env: { ...c.env, ...extra },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    filho.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    filho.stderr.on("data", (d: Buffer) => {
      out += d.toString();
    });
    const guarda = setTimeout(() => {
      filho.kill("SIGKILL");
      reject(new Error(`o roteiro não saiu em 30 s. Saída até aqui: ${out}`));
    }, 30_000);
    filho.on("error", (e) => {
      clearTimeout(guarda);
      reject(e);
    });
    filho.on("close", (rc) => {
      clearTimeout(guarda);
      resolve({ rc, out });
    });
    filho.stdin.end(stdin);
  });
}

/**
 * Instantâneo recursivo do cenário: caminho relativo, tipo e tamanho de tudo
 * + mtime de cada ARQUIVO. Diretório não carrega mtime de propósito: o
 * próprio relatório na Mesa (criado e apagado pelo teste) toca o mtime do
 * diretório Desktop, e qualquer alteração REAL (conteúdo trocado, arquivo
 * regravado) aparece no mtime do arquivo; qualquer movimento aparece na
 * estrutura.
 */
function instantaneo(dir: string): string {
  const linhas: string[] = [];
  const caminhar = (p: string, rel: string): void => {
    const entradas = fs.readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entradas) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        linhas.push(`d ${r}`);
        caminhar(path.join(p, e.name), r);
      } else if (e.isFile()) {
        const st = fs.statSync(path.join(p, e.name));
        linhas.push(`f ${r} ${st.size} ${st.mtimeMs}`);
      } else {
        linhas.push(`o ${r}`);
      }
    }
  };
  caminhar(dir, "");
  return linhas.join("\n");
}

const caminhoDaListagem = (out: string): string => {
  const m = out.match(/Listagem gravada em: (\S+)/);
  assert.ok(m, `a saída do listar deveria dizer onde gravou a listagem. Saída: ${out}`);
  return m[1];
};

const caminhoDoResumo = (out: string): string => {
  const m = out.match(/Resumo em: (\S+)/);
  assert.ok(m, `a saída do testar deveria dizer onde gravou o resumo. Saída: ${out}`);
  return m[1];
};

// --- (a) o script é somente leitura POR CONSTRUÇÃO -----------------------------

test("(a) o script não tem comandos destrutivos, não escreve fora do relatório da Mesa e não decide resultado", () => {
  const conteudo = fs.readFileSync(ROTEIRO, "utf8");

  // O grep do briefing, linha a linha (vale para comentário também): nenhum
  // mv/rm/kill/pkill/killall/ln/cp com espaço — o roteiro nunca move, apaga
  // ou sinaliza nada.
  for (const [i, linha] of conteudo.split("\n").entries()) {
    assert.doesNotMatch(
      linha,
      /(^|[^a-z])(mv|rm|kill|pkill|killall|ln|cp) /u,
      `linha ${i + 1} contém comando destrutivo: ${linha}`,
    );
  }
  // Nem a palavra, de forma nenhuma: quem lê o script não pode encontrar
  // "kill" em texto algum.
  assert.doesNotMatch(conteudo, /kill/iu, "a palavra kill não pode aparecer no script (nem em comentário)");
  // O roteiro não decide resultado: a palavra "aprovado" simplesmente não
  // existe nele (a conferência é da orquestradora, no arquivo da Mesa).
  assert.doesNotMatch(conteudo, /aprovad/iu, "o script não pode conter a palavra aprovado: ele não julga");
  // Nada de arquivo temporário: a única escrita em disco é o relatório.
  assert.doesNotMatch(conteudo, /mktemp/u, "o roteiro não cria arquivo temporário nenhum");

  // Redirecionamento de escrita: o alvo só pode ser o relatório da Mesa
  // ($saida/$resumo) ou /dev/null. Um `>` de redirecionamento vem precedido
  // de espaço, de ":" ou de dígito de fd (`2>`); `>` precedido de letra é
  // TEXTO (como `bruto-listagem-<data>.txt` nos comentários), não shell.
  // >&2 e 2>&1 (stderr) não casam porque o alvo começa com &; heredoc (<<)
  // não é escrita.
  for (const [i, linha] of conteudo.split("\n").entries()) {
    for (const m of linha.matchAll(/(?:^|[\s\d])(>>?)\s*([^\s;&|<>)]+)/gu)) {
      const alvo = m[2].replace(/^"|"$/gu, "");
      assert.ok(
        alvo === "$saida" || alvo === "$resumo" || alvo === "/dev/null",
        `linha ${i + 1}: redirecionamento de escrita fora do relatório da Mesa: ${m[2]}`,
      );
    }
  }
  // tee (a outra forma de gravar o relatório) também só grava na Mesa.
  for (const m of conteudo.matchAll(/tee\s+(?:-{1,2}[\w-]+\s+)*([^\s;&|)]+)/gu)) {
    const alvo = m[1].replace(/^"|"$/gu, "");
    assert.ok(alvo === "$saida" || alvo === "$resumo", `tee fora do relatório da Mesa: ${m[1]}`);
  }
});

// --- (b) listar é somente leitura de verdade ------------------------------------

test("(b) listar não altera nada (estrutura e mtime dos arquivos) e gera o relatório na Mesa", async () => {
  const c = await montar();
  try {
    const antes = instantaneo(c.tmp);
    const r = await rodar(c, ["listar"], "", {
      FALSO_PID: "4242",
      FALSO_CMD: "/usr/local/bin/bruto-servidor --serve",
    });
    assert.equal(r.rc, 0, r.out);

    const listagem = caminhoDaListagem(r.out);
    assert.ok(fs.existsSync(listagem), "o arquivo de listagem deveria existir");
    const conteudo = fs.readFileSync(listagem, "utf8");
    assert.ok(conteudo.includes(`clone: ${c.clone}`), "deveria listar o clone");
    assert.ok(conteudo.includes(`app do usuário: ${c.appUsuario}`), "deveria listar o app do usuário");
    assert.ok(conteudo.includes(`app do sistema: ${c.appSistema}`), "deveria listar o app do sistema");
    assert.ok(conteudo.includes(`dados: ${c.dados}`), "deveria listar os dados");
    assert.ok(conteudo.includes(path.join(c.dados, "library")), "deveria listar a subpasta library de 1º nível");
    assert.ok(conteudo.includes(path.join(c.dados, "ferramentas")), "deveria listar a subpasta ferramentas de 1º nível");
    assert.ok(!conteudo.includes("item.txt"), "não deveria listar o CONTEÚDO de ~/.bruto (só as subpastas de 1º nível)");
    assert.ok(conteudo.includes(c.manifestos[0]), "deveria listar o manifesto do Chrome");
    assert.ok(conteudo.includes(c.manifestos[1]), "deveria listar o manifesto do Edge");
    assert.ok(conteudo.includes("pid 4242"), "deveria informar o PID do que escuta na porta");
    assert.ok(
      conteudo.includes("/usr/local/bin/bruto-servidor --serve"),
      "deveria informar o comando do que escuta na porta",
    );
    assert.ok(conteudo.includes("yt-dlp"), "deveria trazer o informativo do PATH");
    assert.doesNotMatch(conteudo, /provad/iu, "o listar não fala de provado nem julgado");

    // Sem o arquivo de listagem (a única escrita permitida), o cenário é
    // idêntico ao de antes — estrutura E mtime de cada arquivo.
    fs.rmSync(listagem);
    assert.equal(instantaneo(c.tmp), antes, "o listar não pode ter alterado nada no cenário");
  } finally {
    c.limpar();
  }
});

// --- (c) testar coleta (e não decide) -------------------------------------------

test("(c) testar coleta e imprime o corpo bruto, a versão do Info.plist e o fim do log — sem decidir nada", async () => {
  const c = await montar();
  try {
    const corpo = '{"app":"bruto","versao":"9.9.9","origem":"pacote"}';
    const r = await rodar(c, ["testar"], "", { FALSO_CORPO: corpo });
    assert.equal(r.rc, 0, r.out);

    const resumo = fs.readFileSync(caminhoDoResumo(r.out), "utf8");
    for (const [rotulo, texto] of [
      ["saída", r.out],
      ["resumo", resumo],
    ] as const) {
      assert.ok(texto.includes(corpo), `o ${rotulo} deveria trazer o corpo bruto, exatamente como veio`);
      assert.ok(texto.includes("9.9.9"), `o ${rotulo} deveria trazer a versão do Info.plist do app instalado`);
      assert.ok(texto.includes("log-linha-30"), `o ${rotulo} deveria trazer o fim do log (última linha)`);
      assert.ok(texto.includes("log-linha-11"), `o ${rotulo} deveria trazer a 11ª linha (primeira das últimas 20)`);
      assert.ok(!texto.includes("log-linha-10\n"), `o ${rotulo} não deveria trazer a 10ª linha (só as últimas 20)`);
      assert.ok(!texto.includes("log-linha-01\n"), `o ${rotulo} não deveria trazer o começo do log`);
      assert.ok(/orquestradora/.test(texto), `o ${rotulo} deveria mandar o arquivo para a orquestradora conferir`);
      assert.doesNotMatch(texto, /aprovad/iu, `o ${rotulo} não pode conter a palavra aprovado: o roteiro não decide`);
    }
  } finally {
    c.limpar();
  }
});

test("(c) testar sem resposta na espera → exit ≠ 0 com o motivo (o que deu coletar segue no resumo)", async () => {
  const c = await montar();
  try {
    const r = await rodar(c, ["testar"], "", { FALSO_CORPO: "", BRUTO_ROTEIRO_ESPERA: "2" });
    assert.notEqual(r.rc, 0, "sem resposta não houve coleta — exit ≠ 0");
    assert.match(r.out, /não consegui coletar/iu);

    const resumo = fs.readFileSync(caminhoDoResumo(r.out), "utf8");
    assert.match(resumo, /nenhuma resposta/iu, "o motivo deveria estar no resumo");
    assert.ok(resumo.includes("log-linha-30"), "o fim do log acompanha o motivo (para diagnosticar)");
  } finally {
    c.limpar();
  }
});

test("(c) testar sem o app instalado → exit ≠ 0 dizendo para instalar o .dmg primeiro", async () => {
  const c = await montar();
  try {
    const r = await rodar(c, ["testar"], "", {
      BRUTO_ROTEIRO_APP_SISTEMA: path.join(c.tmp, "nao-instalado", "Bruto.app"),
    });
    assert.notEqual(r.rc, 0, "sem app instalado não há o que coletar");
    assert.match(r.out, /não está em/u);
    const resumo = fs.readFileSync(caminhoDoResumo(r.out), "utf8");
    assert.match(resumo, /instale o \.dmg primeiro/u, "o motivo deveria estar no resumo");
  } finally {
    c.limpar();
  }
});

// --- (d) os subcomandos antigos não existem mais --------------------------------

test("(d) limpar e restaurar respondem 'não existe mais' apontando o documento, com exit ≠ 0", async () => {
  const c = await montar();
  try {
    const chamadas = [
      ["limpar"],
      ["restaurar"],
      ["limpar", "--listagem", path.join(c.home, "Desktop", "bruto-listagem-2030-01-01.txt")],
      ["restaurar", "--rodada", "/caminho/qualquer.txt"],
    ] as const;
    for (const args of chamadas) {
      const r = await rodar(c, [...args], "LIMPAR\ns\n");
      assert.notEqual(r.rc, 0, `bash roteiro-macbook-air.sh ${args.join(" ")} deveria terminar com erro`);
      assert.match(r.out, /não existe mais/u, `deveria dizer que o subcomando não existe mais: ${r.out}`);
      assert.match(r.out, /docs\/instalador\/roteiro-macbook-air\.md/u, "deveria apontar o documento com os passos manuais");
    }

    // Nada foi mexido no cenário e nenhum relatório novo apareceu na Mesa.
    assert.ok(fs.existsSync(path.join(c.clone, "launcher", "serve.sh")), "o clone continua no lugar");
    assert.ok(fs.existsSync(path.join(c.clone, ".env")), "o .env do clone continua no lugar");
    assert.ok(fs.existsSync(path.join(c.dados, "library", "item.txt")), "a biblioteca continua no lugar");
    assert.equal(
      fs.readdirSync(c.home).filter((n) => n.includes("-antes-do-teste-")).length,
      0,
      "nenhum backup é criado",
    );
    assert.equal(fs.readdirSync(path.join(c.home, "Desktop")).length, 0, "nada gravado na Mesa");
  } finally {
    c.limpar();
  }
});

// --- (e) todo `mv` do documento é protegido (briefing da rodada 6) ---------------

test("(e) toda linha com `mv` no documento começa com a guarda `[ -e ` e contém `echo \"PARE:`", () => {
  const conteudo = fs.readFileSync(DOCUMENTO, "utf8");

  // O defeito: `mv origem destino`, com destino PASTA que já existe, NÃO dá
  // erro — move a origem PARA DENTRO do destino, em silêncio. Um `mv` simples
  // no documento engoliria um backup antigo sem avisar ninguém (o aviso "se o
  // mv disser que o destino existe, PARE" nunca dispararia). Por isso TODA
  // linha com `mv ` no documento tem de ser a forma guardada, byte a byte a
  // forma provada pela orquestradora com HOME temporário:
  //   [ -e destino ] && echo "PARE: destino já existe" || mv origem destino
  const comMv = conteudo
    .split("\n")
    .map((linha, i) => ({ linha: linha.trimStart(), numero: i + 1 }))
    .filter(({ linha }) => linha.includes("mv "));

  assert.ok(
    comMv.length >= 5,
    `deveria haver ao menos 5 linhas com mv no documento (2 do passo 2 + 3 do passo 5); há ${comMv.length}`,
  );
  for (const { linha, numero } of comMv) {
    assert.ok(
      linha.startsWith("[ -e "),
      `linha ${numero}: mv sem a guarda [ -e … ] — destino existente não faz o mv falhar, ele move PARA DENTRO: ${linha}`,
    );
    assert.ok(
      linha.includes('echo "PARE:'),
      `linha ${numero}: mv sem o aviso "PARE: …" quando o destino já existe: ${linha}`,
    );
  }
});
