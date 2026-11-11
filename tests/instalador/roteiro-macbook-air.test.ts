/**
 * `scripts/instalador-macos/roteiro-macbook-air.sh` — o roteiro que prepara (e
 * testa) um MacBook Air "virgem" para a prova do .dmg. Aqui o script roda com
 * HOME temporário, itens falsos e binários falsos (`lsof`, `ps`, `open`) na
 * frente do PATH; a porta NUNCA é a 3000 (`BRUTO_ROTEIRO_PORTA` aponta para
 * uma porta livre de verdade) e o `~/.bruto` da pessoa nunca é tocado.
 *
 * O fio condutor é a segurança do `limpar`: sem a confirmação digitada LIMPAR
 * nada é removido; o clone `~/Bruto` (pode ter `.env` e mudanças locais) e
 * `~/.bruto` são MOVIDOS, nunca apagados; item que não é do Bruto na listagem
 * reprova a rodada inteira.
 *
 * Rodada 3 (achados do Codex):
 * - AA: o servidor da porta só é encerrado se a identidade for PROVADA —
 *   executável/cwd dentro dos caminhos do Bruto e, respondendo /api/versao,
 *   app=bruto. O nome no comando (`server.js`, `next-server`) NÃO prova nada:
 *   um `node /tmp/outro-projeto/server.js` alheio não pode ser morto.
 * - BB: `testar` só aprova com JSON real (plutil), app=bruto, origem=pacote e
 *   versão igual à do Info.plist do app instalado; qualquer outra coisa é
 *   REPROVADO com exit ≠ 0 e o motivo no resumo.
 * - CC: rollback é o subcomando `restaurar` — a `~/.bruto` recriada pelo
 *   teste vai para `~/.bruto-do-teste-<data>` (nada é apagado) antes de o
 *   backup `-antes-do-teste-<data>` voltar ao lugar.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROTEIRO = path.join(RAIZ, "scripts", "instalador-macos", "roteiro-macbook-air.sh");
const ARQUIVO_HOST = "com.ideiabusiness.bruto.json";

interface Cenario {
  tmp: string;
  home: string;
  clone: string;
  appUsuario: string;
  appSistema: string;
  dados: string;
  manifestos: string[];
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

/** Monta o Air falso: itens do Bruto em HOME temporário + lsof/ps falsos. */
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
  fs.mkdirSync(path.join(appUsuario, "Contents", "MacOS"), { recursive: true });
  escreverExecutavel(path.join(appUsuario, "Contents", "MacOS", "Bruto"), "# app do usuário\n");
  fs.mkdirSync(path.dirname(appSistema), { recursive: true });
  fs.mkdirSync(path.join(appSistema, "Contents", "MacOS"), { recursive: true });
  escreverExecutavel(path.join(appSistema, "Contents", "MacOS", "Bruto"), "# app do sistema\n");
  fs.mkdirSync(path.join(dados, "library"), { recursive: true });
  fs.writeFileSync(path.join(dados, "library", "item.txt"), "vídeo da pessoa");
  fs.mkdirSync(path.join(dados, "ferramentas"), { recursive: true });

  const base = path.join(home, "Library", "Application Support");
  const manifestos = ["Google/Chrome", "Microsoft Edge"].map((navegador) => {
    const alvo = path.join(base, navegador, "NativeMessagingHosts", `${ARQUIVO_HOST}`);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, `{"name":"com.ideiabusiness.bruto","path":"/um/caminho"}\n`);
    return alvo;
  });

  // lsof falso: só a sonda DA PORTA (-iTCP…) é controlada pelo teste (devolve
  // FALSO_PID). Qualquer outra chamada — em especial a do cwd,
  // `lsof -p <pid> -a -d cwd -Fn` — vai para o lsof REAL, porque o cwd é
  // justamente a prova da classe AA e tem de ser medido de verdade.
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
  // ps falso: o "comando" do processo vem de FALSO_CMD (o teste conhece o
  // argv REAL do servidor que subiu — process.execPath + argumentos). Não dá
  // para delegar ao /bin/ps: exec aninhado dele é bloqueado no ambiente de
  // teste (EPERM) — e o que está sob prova é o julgamento do comando, não o ps.
  escreverExecutavel(
    path.join(bin, "ps"),
    '#!/bin/bash\nprintf \'%s\\n\' "${FALSO_CMD:-}"\nexit 0\n',
  );
  // open falso: o testar JAMAIS abre nada de verdade na máquina do teste.
  escreverExecutavel(path.join(bin, "open"), "#!/bin/bash\nexit 0\n");
  // Info.plist REAL no app falso: o testar compara a versão respondida com a
  // CFBundleShortVersionString do app instalado (PlistBuddy de verdade).
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

/** Instantâneo recursivo (caminho relativo, tipo e tamanho) de uma pasta. */
function instantaneo(dir: string): string {
  const linhas: string[] = [];
  const caminhar = (p: string, rel: string): void => {
    const entradas = fs.readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entradas) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        linhas.push(`d ${r}`);
        caminhar(path.join(p, e.name), r);
      } else {
        linhas.push(`f ${r} ${fs.statSync(path.join(p, e.name)).size}`);
      }
    }
  };
  caminhar(dir, "");
  return linhas.join("\n");
}

/** Linha de listagem no formato que o `limpar` lê: etiqueta<TAB>caminho<TAB>info. */
const linha = (tag: string, caminho: string, info = "—"): string => [tag, caminho, info].join("\t");

/** Escapa um texto literal para compor uma RegExp. */
const escaparRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Data local no mesmo formato do `date +%Y-%m-%d` que o roteiro usa. */
const hoje = (): string => {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Backups datados do clone (~/Bruto-antes-do-teste-<data>) existentes no HOME. */
const backupsDoClone = (home: string): string[] =>
  fs.readdirSync(home).filter((n) => n.startsWith("Bruto-antes-do-teste-"));

const caminhoDaListagem = (out: string): string => {
  const m = out.match(/Listagem gravada em: (\S+)/);
  assert.ok(m, `a saída do listar deveria dizer onde gravou a listagem. Saída: ${out}`);
  return m[1];
};

const vivo = (pid: number | undefined): boolean => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const matar = (p: ChildProcess | undefined | null): void => {
  if (!p || p.exitCode !== null) return;
  try {
    p.kill("SIGTERM");
  } catch {
    /* já saiu */
  }
};

interface ServidorFalso {
  proc: ChildProcess;
  /** O comando REAL do processo (argv com o node absoluto) — vira FALSO_CMD. */
  comando: string;
}

/**
 * Sobe um servidor HTTP falso (node DE VERDADE, criado por ESTE teste) com um
 * `server.js` na pasta dada, escutando na porta de teste e respondendo
 * `/api/versao` com `resposta`. `argvAbsoluto` reproduz o caso do achado:
 * `node /caminho/fora/do/Bruto/server.js` (o nome "server.js" no comando
 * NÃO pode mais contar como prova).
 */
const subirServidor = (c: Cenario, pasta: string, resposta: string, argvAbsoluto: boolean): ServidorFalso => {
  fs.mkdirSync(pasta, { recursive: true });
  const arquivo = path.join(pasta, "server.js");
  fs.writeFileSync(
    arquivo,
    [
      "const http = require('http');",
      "http.createServer((req, res) => {",
      "  if (req.url === '/api/versao') {",
      "    res.writeHead(200, { 'content-type': 'application/json' });",
      "    res.end(process.env.FALSA_RESPOSTA);",
      "    return;",
      "  }",
      "  res.writeHead(404); res.end();",
      "}).listen(Number(process.env.BRUTO_ROTEIRO_PORTA), '127.0.0.1');",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  const argv = argvAbsoluto ? arquivo : "server.js";
  const proc = spawn(process.execPath, [argv], {
    cwd: pasta,
    stdio: "ignore",
    env: { ...c.env, FALSA_RESPOSTA: resposta },
  });
  proc.unref();
  return { proc, comando: `${process.execPath} ${argv}` };
};

/** Espera o servidor falso aceitar conexões na porta de teste. */
const esperarPorta = (porta: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const inicio = Date.now();
    const tentar = (): void => {
      const s = net.connect(porta, "127.0.0.1");
      s.on("connect", () => {
        s.destroy();
        resolve();
      });
      s.on("error", () => {
        s.destroy();
        if (Date.now() - inicio > 5_000) reject(new Error("o servidor falso não subiu na porta de teste"));
        else setTimeout(tentar, 50);
      });
    };
    tentar();
  });

test("listar é somente leitura: nada muda (a não ser o arquivo de listagem)", async () => {
  const c = await montar();
  try {
    const antes = instantaneo(c.home);
    const r = await rodar(c, ["listar"], "");
    assert.equal(r.rc, 0, r.out);

    const listagem = caminhoDaListagem(r.out);
    assert.ok(fs.existsSync(listagem), "o arquivo de listagem deveria existir");
    const conteudo = fs.readFileSync(listagem, "utf8");
    assert.ok(conteudo.includes(`clone\t${c.clone}\t`), "deveria listar o clone");
    assert.ok(conteudo.includes(`app-usuario\t${c.appUsuario}\t`), "deveria listar o app do usuário");
    assert.ok(conteudo.includes(`app-sistema\t${c.appSistema}\t`), "deveria listar o app do sistema");
    assert.ok(conteudo.includes(`dados\t${c.dados}\t`), "deveria listar os dados");
    assert.ok(conteudo.includes(`manifesto\t${c.manifestos[0]}\t`), "deveria listar o manifesto do Chrome");
    assert.ok(conteudo.includes(`manifesto\t${c.manifestos[1]}\t`), "deveria listar o manifesto do Edge");
    assert.ok(conteudo.includes("# yt-dlp"), "deveria trazer o informativo do PATH");
    assert.ok(!conteudo.includes("item.txt"), "não deveria listar o CONTEÚDO de ~/.bruto (só as subpastas de 1º nível)");

    // Sem o arquivo de listagem (que é a única escrita permitida), o HOME é
    // idêntico ao de antes.
    fs.rmSync(listagem);
    assert.equal(instantaneo(c.home), antes);
  } finally {
    c.limpar();
  }
});

test("limpar sem a palavra LIMPAR não remove nada (nem com EOF no lugar da resposta)", async () => {
  const c = await montar();
  try {
    const listado = await rodar(c, ["listar"], "");
    const listagem = caminhoDaListagem(listado.out);

    for (const stdin of ["NAO\n", "limpar\n", ""]) {
      const r = await rodar(c, ["limpar", "--listagem", listagem], stdin);
      assert.notEqual(r.rc, 0, `deveria abortar com stdin ${JSON.stringify(stdin)}: ${r.out}`);
      assert.match(r.out, /nada foi removido/i);
    }

    for (const p of [c.clone, c.appUsuario, c.appSistema, c.dados, ...c.manifestos]) {
      assert.ok(fs.existsSync(p), `${p} deveria continuar existindo`);
    }
    assert.equal(
      fs.readdirSync(c.home).filter((n) => n.startsWith(".bruto-antes-do-teste-")).length,
      0,
      "não deveria ter criado backup dos dados",
    );
    assert.equal(backupsDoClone(c.home).length, 0, "não deveria ter criado backup do clone");
  } finally {
    c.limpar();
  }
});

test("limpar com LIMPAR move ~/.bruto (nunca apaga) e remove só o que está na listagem", async () => {
  const c = await montar();
  try {
    // Listagem feita à mão: clone, app do sistema e dados. O app do usuário e
    // os manifestos EXISTEM mas ficam DE FORA — provar que só o que está na
    // listagem é tocado.
    const listagem = path.join(c.home, "Desktop", "listagem-do-teste.txt");
    fs.writeFileSync(
      listagem,
      [
        "# listagem editada à mão para o teste",
        linha("clone", c.clone),
        linha("app-sistema", c.appSistema),
        linha("dados", c.dados, "— o limpar move esta pasta"),
        "",
      ].join("\n"),
    );

    const r = await rodar(c, ["limpar", "--listagem", listagem], "LIMPAR\n");
    assert.equal(r.rc, 0, r.out);

    assert.ok(!fs.existsSync(c.clone), "o clone deveria ter SAÍDO de ~/Bruto (movido, não apagado)");
    assert.ok(!fs.existsSync(c.appSistema), "o app do sistema da listagem deveria ter sido removido");
    assert.ok(!fs.existsSync(c.dados), "~/.bruto deveria ter SAÍDO do lugar original (movido)");

    const movidos = fs.readdirSync(c.home).filter((n) => n.startsWith(".bruto-antes-do-teste-"));
    assert.equal(movidos.length, 1, "deveria existir exatamente um backup datado");
    const movido = path.join(c.home, movidos[0]);
    assert.ok(
      fs.existsSync(path.join(movido, "library", "item.txt")),
      "o conteúdo da biblioteca deveria ter ido junto (movido, não apagado)",
    );

    const backupsClone = backupsDoClone(c.home);
    assert.equal(backupsClone.length, 1, "deveria existir exatamente um backup datado do clone");
    assert.ok(
      fs.existsSync(path.join(c.home, backupsClone[0], "launcher", "serve.sh")),
      "o conteúdo do clone deveria ter ido junto (movido, não apagado)",
    );

    assert.ok(fs.existsSync(c.appUsuario), "o que NÃO está na listagem fica (app do usuário)");
    assert.ok(fs.existsSync(c.manifestos[0]), "o que NÃO está na listagem fica (manifesto)");
  } finally {
    c.limpar();
  }
});

test("limpar com LIMPAR move ~/Bruto (nunca apaga): .env e arquivo local chegam INTEGROS ao backup", async () => {
  const c = await montar();
  try {
    // O clone da instalação antiga pode carregar o `.env` da pessoa (chaves de
    // API) e mudanças locais que não existem em lugar nenhum — apagar é
    // irreversível. O limpar tem de MOVER, como já faz com ~/.bruto.
    fs.writeFileSync(path.join(c.clone, ".env"), "CHAVE=teste-nao-e-segredo\n");
    fs.writeFileSync(path.join(c.clone, "arquivo-local.txt"), "mudanca que nao existe em lugar nenhum\n");

    const listagem = path.join(c.home, "Desktop", "listagem-do-teste.txt");
    fs.writeFileSync(listagem, [linha("clone", c.clone), ""].join("\n"));

    const r = await rodar(c, ["limpar", "--listagem", listagem], "LIMPAR\n");
    assert.equal(r.rc, 0, r.out);

    assert.ok(!fs.existsSync(c.clone), "o clone NÃO pode mais estar em ~/Bruto (foi movido)");

    const backups = backupsDoClone(c.home);
    assert.equal(backups.length, 1, "deveria existir exatamente um backup datado do clone");
    assert.equal(backups[0], `Bruto-antes-do-teste-${hoje()}`, "o backup deveria ter o nome datado de hoje");
    const backup = path.join(c.home, backups[0]);
    assert.ok(
      fs.readFileSync(path.join(backup, ".env"), "utf8").includes("CHAVE=teste-nao-e-segredo"),
      "o .env de mentira deveria estar INTEIRO no backup (movido, não apagado)",
    );
    assert.ok(
      fs.existsSync(path.join(backup, "arquivo-local.txt")),
      "o arquivo local deveria estar no backup (movido, não apagado)",
    );

    // O plano promete MOVER (não REMOVER) o clone, e o fim manda usar o
    // subcomando `restaurar` — um `mv` solto para copiar e colar colocaria o
    // backup DENTRO da ~/.bruto recriada pelo teste (achado 3 da rodada 3).
    assert.match(r.out, new RegExp(`MOVER\\s+${escaparRegex(c.clone)}\\s+→\\s+${escaparRegex(backup)}`));
    assert.match(r.out, /roteiro-macbook-air\.sh restaurar/, "o fim deveria mandar o subcomando restaurar");
    assert.doesNotMatch(r.out, /^ {2}mv /m, "nenhum `mv` de rollback é impresso para copiar e colar");
  } finally {
    c.limpar();
  }
});

test("backup anterior do clone já existindo: o limpar recusa ANTES de mexer em qualquer coisa", async () => {
  const c = await montar();
  try {
    fs.writeFileSync(path.join(c.clone, ".env"), "CHAVE=teste-nao-e-segredo\n");
    const anterior = path.join(c.home, `Bruto-antes-do-teste-${hoje()}`);
    fs.mkdirSync(anterior);
    fs.writeFileSync(path.join(anterior, ".env"), "CHAVE=backup-de-um-teste-anterior\n");

    const listagem = path.join(c.home, "Desktop", "listagem-do-teste.txt");
    fs.writeFileSync(listagem, [linha("clone", c.clone), linha("dados", c.dados), ""].join("\n"));

    const r = await rodar(c, ["limpar", "--listagem", listagem], "LIMPAR\n");
    assert.notEqual(r.rc, 0, "a rodada deveria ser recusada (não sobrescreve backup anterior)");
    assert.match(r.out, /não vou sobrescrever um backup anterior/);
    assert.match(r.out, new RegExp(escaparRegex(anterior)), "a recusa deveria apontar o backup existente");

    assert.ok(fs.existsSync(path.join(c.clone, ".env")), "~/Bruto fica intacto (recusa antes de mexer)");
    assert.ok(fs.existsSync(c.dados), "~/.bruto também fica no lugar");
    assert.ok(fs.existsSync(path.join(anterior, ".env")), "o backup anterior não pode ser tocado");
    assert.equal(backupsDoClone(c.home).length, 1, "nenhum backup novo do clone é criado");
    assert.equal(
      fs.readdirSync(c.home).filter((n) => n.startsWith(".bruto-antes-do-teste-")).length,
      0,
      "nenhum backup dos dados é criado",
    );
  } finally {
    c.limpar();
  }
});

test("item que não é do Bruto no arquivo de listagem é RECUSADO (nada é removido)", async () => {
  const c = await montar();
  try {
    const documents = path.join(c.home, "Documents");
    fs.mkdirSync(documents);
    fs.writeFileSync(path.join(documents, "importante.txt"), "não me apague");

    // Alguém "editou" a listagem e pôs ~/Documents como se fosse clone.
    const listagem = path.join(c.home, "Desktop", "listagem-editada.txt");
    fs.writeFileSync(
      listagem,
      [linha("clone", c.clone), linha("clone", documents), linha("dados", c.dados), ""].join("\n"),
    );

    const r = await rodar(c, ["limpar", "--listagem", listagem], "LIMPAR\n");
    assert.notEqual(r.rc, 0, "a rodada deveria ser recusada");
    assert.match(r.out, /não são do Bruto|NÃO são do Bruto/);
    assert.match(r.out, new RegExp(documents.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "a recusa deveria apontar o item");

    assert.ok(fs.existsSync(path.join(documents, "importante.txt")), "Documents não pode ser tocado");
    assert.ok(fs.existsSync(c.clone), "nem o item VÁLIDO é removido quando a listagem é recusada");
    assert.ok(fs.existsSync(c.dados), "~/.bruto fica no lugar");
    assert.equal(
      fs.readdirSync(c.home).filter((n) => n.startsWith(".bruto-antes-do-teste-")).length,
      0,
      "não deveria ter criado backup dos dados",
    );
    assert.equal(backupsDoClone(c.home).length, 0, "não deveria ter criado backup do clone");
  } finally {
    c.limpar();
  }
});

test("servidor na porta que NÃO é do Bruto não é encerrado", async () => {
  const c = await montar();
  const alheio = spawn("sleep", ["600"], { stdio: "ignore" });
  alheio.unref();
  try {
    const listagem = path.join(c.home, "Desktop", "listagem-do-teste.txt");
    fs.writeFileSync(listagem, [linha("clone", c.clone), linha("dados", c.dados), ""].join("\n"));

    // "s\n" de sobra no stdin: se o roteiro pedisse a confirmação de encerrar
    // (não deveria), o teste quebraria ao ver o processo morto.
    const r = await rodar(c, ["limpar", "--listagem", listagem], "LIMPAR\ns\n", {
      FALSO_PID: String(alheio.pid),
      FALSO_CMD: "/usr/local/bin/servidor-alheio --http",
    });
    assert.equal(r.rc, 0, r.out);
    assert.match(r.out, /NÃO provado ser do Bruto/);
    assert.ok(vivo(alheio.pid), "o processo alheio deveria continuar vivo");
  } finally {
    try {
      alheio.kill("SIGTERM");
    } catch {
      /* já saiu */
    }
    c.limpar();
  }
});

test("servidor do Bruto na porta (server.js) É encerrado quando a pessoa confirma", async () => {
  const c = await montar();
  const servidor = spawn("sleep", ["600"], { stdio: "ignore" });
  servidor.unref();
  try {
    const listagem = path.join(c.home, "Desktop", "listagem-do-teste.txt");
    fs.writeFileSync(listagem, [linha("clone", c.clone), linha("dados", c.dados), ""].join("\n"));

    // O comando tem de apontar para o app do Bruto DESTA máquina de teste
    // (o caminho é a prova — o nome "server.js" sozinho não conta mais).
    const r = await rodar(c, ["limpar", "--listagem", listagem], "LIMPAR\ns\n", {
      FALSO_PID: String(servidor.pid),
      FALSO_CMD: `${c.appSistema}/Contents/Resources/node server.js`,
    });
    assert.equal(r.rc, 0, r.out);
    assert.match(r.out, /TERM enviado/);

    let saiu = false;
    for (let i = 0; i < 30 && !saiu; i++) {
      await new Promise((res) => setTimeout(res, 100));
      saiu = !vivo(servidor.pid);
    }
    assert.ok(saiu, "o servidor do Bruto deveria ter saído após a confirmação");
  } finally {
    try {
      servidor.kill("SIGTERM");
    } catch {
      /* já saiu */
    }
    c.limpar();
  }
});

// --- rodada 3: classe AA (identidade provada, não adivinhada pelo nome) ------

test("AA: server.js de OUTRO projeto na porta NÃO é do Bruto — a listagem diz e o limpar não encerra", async () => {
  const c = await montar();
  const fora = path.join(c.tmp, "fora-do-bruto");
  const { proc: servidor, comando } = subirServidor(c, fora, '{"app":"outro-projeto","versao":"1.0.0","origem":"clone"}', true);
  try {
    await esperarPorta(Number(c.env.BRUTO_ROTEIRO_PORTA));

    const listado = await rodar(c, ["listar"], "", { FALSO_PID: String(servidor.pid), FALSO_CMD: comando });
    assert.equal(listado.rc, 0, listado.out);
    assert.match(listado.out, /NÃO provado ser do Bruto/, "a listagem deveria dizer que não é do Bruto");
    assert.doesNotMatch(listado.out, /pode encerrá-lo/, "não pode oferecer encerrar um processo não provado");

    const listagem = caminhoDaListagem(listado.out);
    // "s\n" de sobra: se o roteiro oferecesse encerrar (não deveria), o
    // servidor morreria e o teste veria o crime.
    const r = await rodar(c, ["limpar", "--listagem", listagem], "LIMPAR\ns\n", {
      FALSO_PID: String(servidor.pid),
      FALSO_CMD: comando,
    });
    assert.equal(r.rc, 0, r.out);
    assert.match(r.out, /NÃO provado ser do Bruto/);
    assert.ok(vivo(servidor.pid), "o servidor do outro projeto deveria continuar vivo");
  } finally {
    matar(servidor);
    c.limpar();
  }
});

test("AA: servidor com cwd no clone ~/Bruto e /api/versao app=bruto É provado do Bruto (e encerrado com confirmação)", async () => {
  const c = await montar();
  const { proc: servidor, comando } = subirServidor(c, c.clone, '{"app":"bruto","versao":"0.0.1","origem":"clone"}', false);
  try {
    await esperarPorta(Number(c.env.BRUTO_ROTEIRO_PORTA));

    const listado = await rodar(c, ["listar"], "", { FALSO_PID: String(servidor.pid), FALSO_CMD: comando });
    assert.equal(listado.rc, 0, listado.out);
    assert.match(listado.out, /PROVADO servidor DO BRUTO/, "a listagem deveria dizer PROVADO");
    assert.match(listado.out, /provas: /, "a listagem deveria mostrar as provas (cwd/comando)");

    const listagem = caminhoDaListagem(listado.out);
    const r = await rodar(c, ["limpar", "--listagem", listagem], "LIMPAR\ns\n", {
      FALSO_PID: String(servidor.pid),
      FALSO_CMD: comando,
    });
    assert.equal(r.rc, 0, r.out);
    assert.match(r.out, /TERM enviado/);

    let saiu = false;
    for (let i = 0; i < 30 && !saiu; i++) {
      await new Promise((res) => setTimeout(res, 100));
      saiu = !vivo(servidor.pid);
    }
    assert.ok(saiu, "o servidor provado do Bruto deveria ter saído após a confirmação");
  } finally {
    matar(servidor);
    c.limpar();
  }
});

test("AA: cwd no ~/Bruto mas /api/versao SEM app=bruto é dúvida — NÃO é do Bruto, não é encerrado", async () => {
  const c = await montar();
  const { proc: servidor, comando } = subirServidor(c, c.clone, '{"app":"coisa-outra","versao":"1.0.0","origem":"clone"}', false);
  try {
    await esperarPorta(Number(c.env.BRUTO_ROTEIRO_PORTA));

    const listado = await rodar(c, ["listar"], "", { FALSO_PID: String(servidor.pid), FALSO_CMD: comando });
    assert.equal(listado.rc, 0, listado.out);
    assert.match(listado.out, /NÃO provado ser do Bruto/);

    const listagem = caminhoDaListagem(listado.out);
    const r = await rodar(c, ["limpar", "--listagem", listagem], "LIMPAR\ns\n", {
      FALSO_PID: String(servidor.pid),
      FALSO_CMD: comando,
    });
    assert.equal(r.rc, 0, r.out);
    assert.ok(vivo(servidor.pid), "dúvida ≠ prova: o servidor deveria continuar vivo");
  } finally {
    matar(servidor);
    c.limpar();
  }
});

// --- rodada 3: classe BB (testar só aprova o que provou) ----------------------

const resumoDoTeste = (c: Cenario): string =>
  fs.readFileSync(path.join(c.home, "Desktop", `bruto-teste-${hoje()}.txt`), "utf8");

test("BB: testar REPROVA /api/versao com origem=clone (exit ≠ 0 e o motivo no resumo)", async () => {
  const c = await montar();
  const { proc: servidor } = subirServidor(c, path.join(c.tmp, "app-do-clone"), '{"app":"bruto","versao":"9.9.9","origem":"clone"}', false);
  try {
    await esperarPorta(Number(c.env.BRUTO_ROTEIRO_PORTA));
    const r = await rodar(c, ["testar"], "");
    assert.notEqual(r.rc, 0, "origem=clone não pode ser aprovado");
    assert.match(r.out, /REPROVADO/);
    assert.match(r.out, /origem=clone/);
    assert.match(resumoDoTeste(c), /origem=clone/, "o resumo deveria dizer o porquê");
  } finally {
    matar(servidor);
    c.limpar();
  }
});

test("BB: testar REPROVA corpo que não é JSON (exit ≠ 0 e o motivo no resumo)", async () => {
  const c = await montar();
  const { proc: servidor } = subirServidor(c, path.join(c.tmp, "app-nao-json"), "servidor no ar — não sou JSON", false);
  try {
    await esperarPorta(Number(c.env.BRUTO_ROTEIRO_PORTA));
    const r = await rodar(c, ["testar"], "");
    assert.notEqual(r.rc, 0, "corpo não-JSON não pode ser aprovado");
    assert.match(r.out, /REPROVADO/);
    assert.match(r.out, /não é JSON/);
    assert.match(resumoDoTeste(c), /não é JSON/, "o resumo deveria dizer o porquê");
  } finally {
    matar(servidor);
    c.limpar();
  }
});

test("BB: testar REPROVA versão diferente da do Info.plist do app instalado", async () => {
  const c = await montar();
  const { proc: servidor } = subirServidor(c, path.join(c.tmp, "app-versao-errada"), '{"app":"bruto","versao":"0.0.1","origem":"pacote"}', false);
  try {
    await esperarPorta(Number(c.env.BRUTO_ROTEIRO_PORTA));
    const r = await rodar(c, ["testar"], "");
    assert.notEqual(r.rc, 0, "versão ≠ Info.plist não pode ser aprovado");
    assert.match(r.out, /REPROVADO/);
    assert.match(r.out, /0\.0\.1/);
    assert.match(r.out, /9\.9\.9/);
    assert.match(resumoDoTeste(c), /9\.9\.9/, "o resumo deveria citar a versão esperada");
  } finally {
    matar(servidor);
    c.limpar();
  }
});

test("BB: testar APROVA o servidor provado do pacote (app=bruto, origem=pacote, versão igual à do Info.plist)", async () => {
  const c = await montar();
  const { proc: servidor } = subirServidor(c, path.join(c.tmp, "app-bom"), '{"app":"bruto","versao":"9.9.9","origem":"pacote"}', false);
  try {
    await esperarPorta(Number(c.env.BRUTO_ROTEIRO_PORTA));
    const r = await rodar(c, ["testar"], "");
    assert.equal(r.rc, 0, r.out);
    assert.match(r.out, /PROVADO/);
    assert.match(r.out, /9\.9\.9/);
  } finally {
    matar(servidor);
    c.limpar();
  }
});

// --- rodada 3: classe CC (rollback seguro no estado em que a pessoa está) -----

test("CC: restaurar preserva a ~/.bruto recriada pelo teste em -do-teste- e devolve o backup INTEIRO", async () => {
  const c = await montar();
  try {
    // 1) o limpar de antes do teste moveu clone e dados para os backups.
    const listagem = path.join(c.home, "Desktop", "listagem-do-teste.txt");
    fs.writeFileSync(listagem, [linha("clone", c.clone), linha("dados", c.dados), ""].join("\n"));
    const l = await rodar(c, ["limpar", "--listagem", listagem], "LIMPAR\n");
    assert.equal(l.rc, 0, l.out);

    // 2) o teste do .dmg recriou ~/.bruto (e ~/Bruto) com coisa NOVA.
    fs.mkdirSync(path.join(c.dados, "library"), { recursive: true });
    fs.writeFileSync(path.join(c.dados, "library", "novo-do-teste.txt"), "biblioteca recriada pelo teste");
    fs.mkdirSync(path.join(c.clone, "novapasta"), { recursive: true });
    fs.writeFileSync(path.join(c.clone, "novapasta", "local.txt"), "clone recriado");

    // 3) o rollback certo agora é o subcomando restaurar.
    const r = await rodar(c, ["restaurar"], "");
    assert.equal(r.rc, 0, r.out);

    const dadosDoTeste = path.join(c.home, `.bruto-do-teste-${hoje()}`);
    const cloneDoTeste = path.join(c.home, `Bruto-do-teste-${hoje()}`);
    assert.ok(
      fs.existsSync(path.join(dadosDoTeste, "library", "novo-do-teste.txt")),
      "a biblioteca recriada pelo teste deveria estar preservada em ~/.bruto-do-teste-<data>",
    );
    assert.ok(
      fs.existsSync(path.join(cloneDoTeste, "novapasta", "local.txt")),
      "o clone recriado pelo teste deveria estar preservado em ~/Bruto-do-teste-<data>",
    );
    assert.ok(fs.existsSync(path.join(c.dados, "library", "item.txt")), "o backup da biblioteca deveria voltar INTEIRO");
    assert.ok(!fs.existsSync(path.join(c.dados, "library", "novo-do-teste.txt")), "a pasta do teste não pode se misturar com a restaurada");
    assert.ok(fs.existsSync(path.join(c.clone, "launcher", "serve.sh")), "o backup do clone deveria voltar inteiro");
    assert.ok(
      !fs.existsSync(path.join(c.home, `.bruto-antes-do-teste-${hoje()}`)),
      "o backup dos dados não deveria mais existir (foi restaurado)",
    );
    assert.ok(
      !fs.existsSync(path.join(c.home, `Bruto-antes-do-teste-${hoje()}`)),
      "o backup do clone não deveria mais existir (foi restaurado)",
    );
    assert.match(r.out, /roteiro|✓/, "a saída deveria narrar o que moveu");
  } finally {
    c.limpar();
  }
});

test("CC: restaurar RECUSA (sem mover nada) quando o destino -do-teste- de hoje já existe", async () => {
  const c = await montar();
  try {
    const listagem = path.join(c.home, "Desktop", "listagem-do-teste.txt");
    fs.writeFileSync(listagem, [linha("clone", c.clone), linha("dados", c.dados), ""].join("\n"));
    const l = await rodar(c, ["limpar", "--listagem", listagem], "LIMPAR\n");
    assert.equal(l.rc, 0, l.out);

    // o teste recriou ~/.bruto e já existe um -do-teste- de hoje (de uma
    // restauração anterior): a rodada tem de ser recusada inteira.
    fs.mkdirSync(path.join(c.dados, "library"), { recursive: true });
    fs.writeFileSync(path.join(c.dados, "library", "recriada.txt"), "biblioteca do teste");
    const doTeste = path.join(c.home, `.bruto-do-teste-${hoje()}`);
    fs.mkdirSync(doTeste);
    fs.writeFileSync(path.join(doTeste, "marca.txt"), "não me sobrescreva");

    const r = await rodar(c, ["restaurar"], "");
    assert.notEqual(r.rc, 0, "a restauração deveria ser recusada");
    assert.match(r.out, /não vou sobrescrever|Já existe/);
    assert.ok(fs.existsSync(path.join(doTeste, "marca.txt")), "o -do-teste- existente não pode ser tocado");
    assert.ok(fs.existsSync(path.join(c.dados, "library", "recriada.txt")), "~/.bruto recriada fica no lugar");
    assert.ok(
      fs.existsSync(path.join(c.home, `.bruto-antes-do-teste-${hoje()}`, "library", "item.txt")),
      "o backup não pode ser consumido numa rodada recusada",
    );
  } finally {
    c.limpar();
  }
});

test("CC: restaurar com servidor PROVADO do Bruto no ar e a pessoa recusando fechar: aborta sem mover nada", async () => {
  const c = await montar();
  const pastaApp = path.join(c.appSistema, "Contents", "Resources", "app");
  const { proc: servidor, comando } = subirServidor(c, pastaApp, '{"app":"bruto","versao":"9.9.9","origem":"pacote"}', false);
  try {
    const listagem = path.join(c.home, "Desktop", "listagem-do-teste.txt");
    fs.writeFileSync(listagem, [linha("clone", c.clone), linha("dados", c.dados), ""].join("\n"));
    const l = await rodar(c, ["limpar", "--listagem", listagem], "LIMPAR\n");
    assert.equal(l.rc, 0, l.out);
    await esperarPorta(Number(c.env.BRUTO_ROTEIRO_PORTA));

    fs.mkdirSync(path.join(c.dados, "library"), { recursive: true });
    fs.writeFileSync(path.join(c.dados, "library", "recriada.txt"), "biblioteca do teste");

    const r = await rodar(c, ["restaurar"], "n\n", { FALSO_PID: String(servidor.pid), FALSO_CMD: comando });
    assert.notEqual(r.rc, 0, "recusar fechar o Bruto deveria abortar a restauração");
    assert.match(r.out, /nada foi movido|ABORTADO/);
    assert.ok(vivo(servidor.pid), "a decisão da pessoa (não fechar) é respeitada");
    assert.ok(fs.existsSync(path.join(c.dados, "library", "recriada.txt")), "~/.bruto recriada fica no lugar");
    assert.ok(
      fs.existsSync(path.join(c.home, `.bruto-antes-do-teste-${hoje()}`)),
      "o backup não pode ser consumido numa rodada abortada",
    );
  } finally {
    matar(servidor);
    c.limpar();
  }
});
