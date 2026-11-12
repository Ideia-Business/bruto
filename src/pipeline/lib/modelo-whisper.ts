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

/**
 * Nome curto → repositório mlx-community conferido no Hugging Face. */
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
 * O modelo Whisper padrão do app: `large-v3-turbo` desde 12/11/2026 (antes,
 * `base`). A troca partiu de medição do dono em português (3 min de fala,
 * MacBook Air M5): turbo 21 s contra 8 s do base, mas com 101 palavras
 * diferentes do turbo no base e 55 no small — a transcrição do base era a
 * pior de longe; o turbo é o melhor custo/qualidade. `base` segue válido
 * via `BRUTO_WHISPER_MODEL=base` para quem preferir o antigo.
 *
 * Fonte única: transcribe.ts (execução) e ferramentas.ts (download
 * antecipado na instalação) leem DAQUI — nunca redeclaram o padrão.
 */
export const MODELO_WHISPER_PADRAO = "large-v3-turbo";

/**
 * O modelo Whisper que o app deve usar: `BRUTO_WHISPER_MODEL` continua
 * mandando; sem a variável, o padrão. Função (não constante) de propósito:
 * ler na hora da transcrição — e não na carga do módulo — é o que permite
 * trocar a variável sem reiniciar o processo (instalação sob pedido, testes).
 */
export function modeloWhisper(): string {
  return process.env.BRUTO_WHISPER_MODEL || MODELO_WHISPER_PADRAO;
}

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
