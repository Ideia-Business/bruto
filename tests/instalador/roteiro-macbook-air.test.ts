/**
 * `scripts/instalador-macos/roteiro-macbook-air.sh` — o roteiro que prepara (e
 * testa) um MacBook Air "virgem" para a prova do .dmg. Aqui o script roda com
 * HOME temporário, itens falsos e binários falsos (`lsof`, `ps`) na frente do
 * PATH; a porta NUNCA é a 3000 (`BRUTO_ROTEIRO_PORTA` aponta para uma porta
 * livre de verdade) e o `~/.bruto` da pessoa nunca é tocado.
 *
 * O fio condutor é a segurança do `limpar`: sem a confirmação digitada LIMPAR
 * nada é removido; o clone `~/Bruto` (pode ter `.env` e mudanças locais) e
 * `~/.bruto` são MOVIDOS, nunca apagados; item que não é do Bruto na listagem
 * reprova a rodada inteira; e o servidor da porta só é encerrado se o comando
 * for do Bruto (`next-server`/`server.js`/`serve.sh`).
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

function portaLivre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
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

  // lsof falso: só "acha" um listener se FALSO_PID estiver definido no ambiente.
  escreverExecutavel(
    path.join(bin, "lsof"),
    '#!/bin/bash\nif [ -n "${FALSO_PID:-}" ]; then printf \'p%s\\n\' "$FALSO_PID"; fi\nexit 0\n',
  );
  // ps falso: o "comando" do processo vem de FALSO_CMD.
  escreverExecutavel(
    path.join(bin, "ps"),
    '#!/bin/bash\nprintf \'%s\\n\' "${FALSO_CMD:-PROCESSO_DESCONHECIDO}"\nexit 0\n',
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

    // O plano promete MOVER (não REMOVER) o clone, e o fim imprime o rollback dele.
    assert.match(r.out, new RegExp(`MOVER\\s+${escaparRegex(c.clone)}\\s+→\\s+${escaparRegex(backup)}`));
    assert.match(
      r.out,
      new RegExp(`mv\\s+${escaparRegex(backup)}\\s+${escaparRegex(c.clone)}`),
      "o fim deveria imprimir o rollback do clone (mv do backup de volta ao lugar)",
    );
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
    assert.match(r.out, /não é do Bruto|NÃO é do Bruto/);
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

    const r = await rodar(c, ["limpar", "--listagem", listagem], "LIMPAR\ns\n", {
      FALSO_PID: String(servidor.pid),
      FALSO_CMD: "/Applications/Bruto.app/Contents/Resources/node server.js",
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
