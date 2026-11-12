#!/usr/bin/env bash
# medir-whisper.sh — mede o tempo de transcrição por modelo Whisper no
# backend mlx, pelo MESMO caminho que o app usa (demanda 00a39140):
#
#   - o Python é achado como o app acha (`pythonParaMlx` em transcribe.ts):
#     primeiro o venv isolado do `uv tool install mlx-whisper`, depois o
#     `python3` do PATH;
#   - o nome do modelo é resolvido para o repositório real do Hugging Face
#     pela MESMA tabela de `src/pipeline/lib/modelo-whisper.ts` (espelhada
#     aqui em bash — ao mexer lá, mexa aqui);
#   - a transcrição é o script Python embutido chamando
#     `mlx_whisper.transcribe(..., language="pt")`, como o SCRIPT_MLX do app.
#
# Uso:
#   scripts/medir-whisper.sh <audio> <saida_dir> [modelo...]
#
# Sem lista de modelos, mede: base small medium large-v3-turbo.
#
# Para cada modelo grava:
#   <saida_dir>/<modelo>.txt   — a transcrição (vazio se o modelo falhou);
#   uma linha em <saida_dir>/medicao.tsv:
#     modelo <TAB> segundos <TAB> rc <TAB> tamanho_modelo_MB
#   (tamanho = `du -smL` da pasta `snapshots/` do modelo no cache do Hugging
#   Face DEPOIS de rodar; 0 quando a pasta não existe — ex.: o modelo falhou
#   antes de baixar). O porquê do -L: no cache do HF (formato xet, conferido
#   em máquina real) `snapshots/<rev>/<pesos>` é SYMLINK para `blobs/<etag>`,
#   que por sua vez é SYMLINK para o cache compartilhado no nível do hub —
#   FORA da pasta do modelo. `du` sem seguir links conta só os ponteiros
#   (~1 MB) e reporta small/medium/turbo como se fossem vazios.
#
# Não apaga nada e não baixa nada além do que o próprio mlx baixa. A falha
# de um modelo NÃO para os outros — o rc de cada um fica na tabela. O
# script só sai com código ≠ 0 por erro de uso ou por não achar Python;
# nesse caso, o resultado por-modelo está na coluna rc do TSV.

set -u
set -o pipefail

MODELOS_PADRAO="base small medium large-v3-turbo"

uso() {
  cat >&2 <<'EOF'
uso: medir-whisper.sh <audio> <saida_dir> [modelo...]
  <audio>     arquivo de áudio a transcrever
  <saida_dir> diretório das saídas (criado se não existir; nada é apagado)
  [modelo...] nomes curtos (base, large-v3-turbo, ...) ou repos org/nome;
              padrão: base small medium large-v3-turbo
EOF
}

# Espelho de repositorioMlx() em src/pipeline/lib/modelo-whisper.ts.
repositorio_mlx() {
  case "$1" in
    */*) printf '%s\n' "$1" ;;
    tiny | base | small | medium) printf 'mlx-community/whisper-%s-mlx\n' "$1" ;;
    large-v3) printf '%s\n' "mlx-community/whisper-large-v3-mlx" ;;
    large-v3-turbo) printf '%s\n' "mlx-community/whisper-large-v3-turbo" ;;
    *) printf 'mlx-community/whisper-%s-mlx\n' "$1" ;;
  esac
}

# Espelho de pythonParaMlx() em src/pipeline/lib/transcribe.ts: o venv
# isolado do `uv tool install mlx-whisper` primeiro; `python3` do PATH
# como fallback (o app só pula o fallback no modo pacote).
achar_python() {
  local base=""
  if [ -n "${UV_TOOL_DIR:-}" ]; then
    base=$UV_TOOL_DIR
  elif [ -n "${XDG_DATA_HOME:-}" ]; then
    base=$XDG_DATA_HOME/uv/tools
  elif [ -n "${HOME:-}" ]; then
    base=$HOME/.local/share/uv/tools
  fi
  if [ -n "$base" ] && [ -x "$base/mlx-whisper/bin/python" ]; then
    printf '%s\n' "$base/mlx-whisper/bin/python"
    return 0
  fi
  command -v python3 2>/dev/null
}

# Tamanho (MB) da pasta do modelo no cache do Hugging Face, depois da
# transcrição. `models--<org>--<nome>` é o formato do cache do hub.
# Mede a pasta `snapshots/` COM symlinks seguidos (-L): no cache xet os
# pesos vivem fora da pasta do modelo (cadeia snapshots → blobs → hub/blobs),
# e um `du` sem -L conta só os ponteiros. Sem `snapshots/` (estrutura fora
# do padrão do hub), cai para o `du -smL` da pasta toda.
tamanho_modelo_mb() {
  local repo=$1 cache dir
  if [ -n "${HF_HUB_CACHE:-}" ]; then
    cache=$HF_HUB_CACHE
  elif [ -n "${HF_HOME:-}" ]; then
    cache=$HF_HOME/hub
  else
    cache=$HOME/.cache/huggingface/hub
  fi
  dir="$cache/models--${repo//\//--}"
  if [ -d "$dir/snapshots" ]; then
    du -smL "$dir/snapshots" | awk '{print $1}'
  elif [ -d "$dir" ]; then
    du -smL "$dir" | awk '{print $1}'
  else
    printf '0\n'
  fi
}

# Mesmo script do SCRIPT_MLX do app: isola o stdout da biblioteca e imprime
# só o texto. `model` já chega RESOLVIDO (repositório real do Hugging Face).
SCRIPT_PY=$(cat <<'PYEOF'
import os, sys, warnings
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
warnings.filterwarnings("ignore")
import io, contextlib
from mlx_whisper import transcribe
wav, model, lang = sys.argv[1], sys.argv[2], sys.argv[3]
kwargs = {"path_or_hf_repo": model, "verbose": False}
if lang:
    kwargs["language"] = lang
buf = io.StringIO()
with contextlib.redirect_stdout(buf), contextlib.redirect_stderr(sys.stderr):
    result = transcribe(wav, **kwargs)
text = (result.get("text") or "").strip()
if not text:
    text = buf.getvalue().strip().splitlines()[-1] if buf.getvalue().strip() else ""
print(text)
PYEOF
)

if [ $# -lt 2 ]; then
  uso
  exit 2
fi

AUDIO=$1
SAIDA=$2
shift 2

if [ ! -f "$AUDIO" ]; then
  echo "erro: audio nao existe: $AUDIO" >&2
  exit 2
fi

if [ $# -gt 0 ]; then
  MODELOS="$*"
else
  MODELOS=$MODELOS_PADRAO
fi

PYTHON=$(achar_python)
if [ -z "$PYTHON" ]; then
  echo "erro: nenhum Python com mlx_whisper encontrado (nem o venv do 'uv tool install mlx-whisper', nem python3 no PATH)" >&2
  exit 1
fi

mkdir -p "$SAIDA"
TSV="$SAIDA/medicao.tsv"
if [ ! -f "$TSV" ]; then
  printf 'modelo\tsegundos\trc\ttamanho_modelo_MB\n' >"$TSV"
fi

echo "python: $PYTHON"
for MODELO in $MODELOS; do
  REPO=$(repositorio_mlx "$MODELO")
  SLUG=$(printf '%s' "$MODELO" | tr '/ ' '__')
  TXT="$SAIDA/$SLUG.txt"
  INICIO=$SECONDS
  "$PYTHON" - "$AUDIO" "$REPO" pt >"$TXT" <<<"$SCRIPT_PY"
  RC=$?
  SEGUNDOS=$((SECONDS - INICIO))
  TAMANHO=$(tamanho_modelo_mb "$REPO")
  printf '%s\t%s\t%s\t%s\n' "$MODELO" "$SEGUNDOS" "$RC" "$TAMANHO" >>"$TSV"
  if [ "$RC" -eq 0 ]; then
    echo "ok     $MODELO (${SEGUNDOS}s, ${TAMANHO} MB)"
  else
    echo "FALHOU $MODELO (rc=$RC) — continuando com os demais"
  fi
done
echo "medição em $TSV"
exit 0
