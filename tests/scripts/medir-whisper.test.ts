/**
 * `scripts/medir-whisper.sh` — o script de medição de modelos Whisper
 * (demanda 00a39140): para cada modelo, roda o MESMO caminho do backend mlx
 * do app (o Python achado como o app acha + script embutido chamando
 * `mlx_whisper.transcribe` com idioma `pt`), mede o tempo de parede e grava
 * `<saida>/<modelo>.txt` + uma linha em `<saida>/medicao.tsv`
 * (`modelo	segundos	rc	tamanho_modelo_MB`).
 *
 * Aqui NADA é baixado e nenhum modelo real roda: o PATH recebe um `python3`
 * FALSO (bash) que consome o script do stdin, cria uma pasta de cache HF
 * falsa (para o `du` medir) e imprime uma transcrição — e FALHA (exit 1)
 * quando o repositório contém "falha", provando que um modelo quebrado não
 * para os demais. HOME e HF_HUB_CACHE apontam para diretórios temporários;
 * UV_TOOL_DIR aponta para um diretório inexistente, forçando o fallback
 * para o `python3` do PATH (o mesmo fallback do app fora do modo pacote).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = path.join(RAIZ, "scripts", "medir-whisper.sh");

/** python3 falso: imita o `python - <wav> <repo> <lang>` do backend mlx. */
const PYTHON_FALSO = `#!/usr/bin/env bash
[ "\${1:-}" = "-" ] || exit 2
repo="\${3:-}"
lang="\${4:-}"
cat >/dev/null
case "$repo" in
  *falha*) echo "download simulado quebrado" >&2; exit 1 ;;
esac
cache="\${HF_HUB_CACHE:-$HOME/.cache/huggingface/hub}"
dir="$cache/models--\${repo//\\//--}"
# Estrutura REAL do cache do Hugging Face (confirmada em máquina real):
# snapshots/<rev>/<arquivo> é SYMLINK para ../../blobs/<etag>, e o blob é
# SYMLINK para o cache Xet COMPARTILHADO no nível do hub (fora do dir do
# modelo). É por isso que "du -sm <dir do modelo>" sem seguir links mede
# ~1 MB: os pesos de verdade moram em outro lugar.
mkdir -p "$dir/blobs" "$dir/snapshots/rev1" "$cache/blobs/8e"
head -c 2097152 /dev/zero > "$cache/blobs/8e/pesos"
ln -sfn "../../blobs/8e/pesos" "$dir/blobs/etag1"
ln -sfn "../../blobs/etag1" "$dir/snapshots/rev1/weights.npz"
printf 'transcricao de %s em %s\\n' "$repo" "$lang"
exit 0
`;

type Cenario = {
  dir: string;
  home: string;
  hfCache: string;
  saida: string;
  wav: string;
  env: NodeJS.ProcessEnv;
};

function montarCenario(): Cenario {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "medir-whisper-"));
  const home = path.join(dir, "home");
  const hfCache = path.join(dir, "hf-cache");
  const fakeBin = path.join(dir, "bin");
  const saida = path.join(dir, "saida");
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, "python3"), PYTHON_FALSO, { mode: 0o755 });
  const wav = path.join(dir, "audio.wav");
  fs.writeFileSync(wav, "RIFF-falso");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${fakeBin}:/usr/bin:/bin`,
    HOME: home,
    HF_HUB_CACHE: hfCache,
    // Força o fallback para o python3 do PATH (o venv do uv "não existe").
    UV_TOOL_DIR: path.join(dir, "uv-tools-inexistente"),
  };
  delete env.XDG_DATA_HOME;
  return { dir, home, hfCache, saida, wav, env };
}

function rodar(cenario: Cenario, args: string[]) {
  return spawnSync("bash", [SCRIPT, ...args], { env: cenario.env, encoding: "utf8" });
}

function lerTsv(saida: string): string[][] {
  return fs
    .readFileSync(path.join(saida, "medicao.tsv"), "utf8")
    .trim()
    .split("\n")
    .map((l) => l.split("\t"));
}

describe("medir-whisper.sh — com mlx_whisper falso no PATH", () => {
  test("mede dois modelos; o que falha tem rc≠0 na tabela e NÃO para o outro", () => {
    const c = montarCenario();
    const r = rodar(c, [c.wav, c.saida, "base", "falha"]);
    assert.equal(r.status, 0, `script devolveu ${r.status}: ${r.stderr}`);

    // A transcrição do modelo que funcionou saiu no <modelo>.txt, com o
    // repositório RESOLVIDO e o idioma pt (mesmos do app).
    const txt = fs.readFileSync(path.join(c.saida, "base.txt"), "utf8");
    assert.match(txt, /transcricao de mlx-community\/whisper-base-mlx em pt/);

    // O do modelo que falhou existe (vazio): o arquivo é do redirecionamento,
    // não do sucesso — quem lê a tabela é que sabe o resultado.
    assert.equal(fs.readFileSync(path.join(c.saida, "falha.txt"), "utf8"), "");

    const linhas = lerTsv(c.saida);
    assert.deepEqual(linhas[0], ["modelo", "segundos", "rc", "tamanho_modelo_MB"]);
    assert.equal(linhas.length, 3);

    const [base, falha] = [linhas[1], linhas[2]];
    assert.equal(base[0], "base");
    assert.match(base[1], /^\d+$/);
    assert.equal(base[2], "0");
    // Os pesos são SYMLINKS (cadeia snapshots → blobs → xet, como no cache
    // real do HF): só contam se o `du` seguir os links. O bug original
    // media 1 MB aqui — o teste reprova a regressão.
    assert.ok(Number(base[3]) >= 2, `tamanho real do modelo via symlinks, veio ${base[3]}`);

    assert.equal(falha[0], "falha");
    assert.match(falha[1], /^\d+$/);
    assert.equal(falha[2], "1");
    assert.equal(falha[3], "0"); // o falso não "baixou" nada antes de falhar
  });

  test("sem lista de modelos, mede o padrão: base small medium large-v3-turbo", () => {
    const c = montarCenario();
    const r = rodar(c, [c.wav, c.saida]);
    assert.equal(r.status, 0, `script devolveu ${r.status}: ${r.stderr}`);

    const linhas = lerTsv(c.saida);
    assert.deepEqual(
      linhas.slice(1).map((l) => l[0]),
      ["base", "small", "medium", "large-v3-turbo"],
    );
    for (const l of linhas.slice(1)) assert.equal(l[2], "0");

    // large-v3-turbo resolveu para o repo SEM o sufixo -mlx (a regressão do item 1):
    const turbo = fs.readFileSync(path.join(c.saida, "large-v3-turbo.txt"), "utf8");
    assert.match(turbo, /transcricao de mlx-community\/whisper-large-v3-turbo em pt/);
  });

  test("áudio inexistente é erro de uso (rc≠0), sem criar saída", () => {
    const c = montarCenario();
    const r = rodar(c, [path.join(c.dir, "nao-existe.wav"), c.saida]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /audio|áudio/i);
    assert.ok(!fs.existsSync(path.join(c.saida, "medicao.tsv")));
  });
});
