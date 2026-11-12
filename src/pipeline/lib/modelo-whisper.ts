/**
 * modelo-whisper — resolve o nome curto do Whisper (`BRUTO_WHISPER_MODEL`)
 * para o repositório REAL do backend mlx no Hugging Face.
 *
 * Por que existe (demanda 00a39140): o backend mlx montava sempre
 * `mlx-community/whisper-{modelo}-mlx`. Isso serve para tiny/base/small/
 * medium/large-v3, mas NÃO para `large-v3-turbo`, cujo repositório é
 * `mlx-community/whisper-large-v3-turbo` (sem o sufixo `-mlx`). Com
 * `BRUTO_WHISPER_MODEL=large-v3-turbo` a transcrição falharia tentando
 * baixar um repositório inexistente.
 *
 * A tabela abaixo foi conferida repo a repo na API pública do Hugging Face
 * (`https://huggingface.co/api/models/mlx-community/<repo>` → HTTP 200)
 * em 12/11/2026. O `scripts/medir-whisper.sh` espelha esta mesma tabela
 * (bash não importa TypeScript) — ao mexer aqui, mexa lá.
 */

/** Nome curto → repositório mlx-community conferido no Hugging Face. */
const REPOSITORIOS_CONHECIDOS: Record<string, string> = {
  tiny: "mlx-community/whisper-tiny-mlx",
  base: "mlx-community/whisper-base-mlx",
  small: "mlx-community/whisper-small-mlx",
  medium: "mlx-community/whisper-medium-mlx",
  "large-v3": "mlx-community/whisper-large-v3-mlx",
  // Único da família SEM o sufixo `-mlx` — era ele que quebrava na regra antiga.
  "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
};

/**
 * Resolve o nome do modelo para o repositório do backend mlx.
 *
 * - Nome com `/` já é um repositório completo (`org/repo`) e passa como está.
 * - Nome conhecido usa a tabela conferida acima.
 * - Nome desconhecido cai no padrão histórico `mlx-community/whisper-<nome>-mlx`
 *   (decisão: passar adiante, não erro — é o que o código sempre fez e a
 *   maioria dos repos whisper do mlx-community segue esse padrão, ex.:
 *   `large-v2`; um erro aqui quebraria modelos válidos fora da tabela).
 */
export function repositorioMlx(nome: string): string {
  if (nome.includes("/")) return nome;
  const conhecido = REPOSITORIOS_CONHECIDOS[nome];
  if (conhecido) return conhecido;
  return `mlx-community/whisper-${nome}-mlx`;
}
