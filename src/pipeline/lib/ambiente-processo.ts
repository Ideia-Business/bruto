/**
 * ambiente-processo — o ambiente que processo EXTERNO do Bruto recebe.
 *
 * FUNÇÃO ÚNICA (r4 → r5): a transcrição (`rodar`, transcribe.ts) e o download
 * antecipado do modelo (`baixarModeloWhisper`, ferramentas.ts) montam o
 * ambiente do filho POR ESTA FUNÇÃO. A r4 fechou o cache divergente com uma
 * LISTA de variáveis (HF_HOME etc.); a r5 fechou a CLASSE: o download roda
 * com EXATAMENTE o ambiente da transcrição — se amanhã o huggingface_hub
 * honrar mais uma variável de cache, os dois processos a recebem (ou não)
 * JUNTOS, e o modelo não pode mais ser baixado num cache e procurado noutro.
 *
 * Isto não é zelo decorativo: o que estes processos imprimem no stderr entra
 * na mensagem de erro, e a mensagem de erro é PERSISTIDA em
 * `jobs.error_message`. Com o ambiente inteiro, uma falha que ecoasse o env
 * gravaria a chave de quem usa, no banco, para sempre.
 */
import { ambienteCacheModelo } from "@/pipeline/lib/modelo-whisper";

/**
 * O que um processo externo de transcrição legitimamente precisa: achar
 * binários, saber onde é a casa, escrever temporário e formatar texto.
 * Nenhuma credencial atravessa — as variáveis de CACHE do modelo (`HF_HOME`
 * etc.) sim, porque são caminhos, não segredos, e porque download e
 * transcrição têm de resolver o MESMO cache (r4/P2; ver acima).
 */
export function ambienteMinimo(): NodeJS.ProcessEnv {
  // NODE_ENV entra porque o tipo do Node o exige e porque não é segredo —
  // ferramentas de linha de comando costumam consultá-lo.
  const permitidas = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SHELL", "USER", "NODE_ENV"];
  // No Windows não existem HOME/TMPDIR/USER/SHELL — quem os substitui são
  // estas outras, e um Python instalado no Windows falha sem SYSTEMROOT (ele
  // usa a variável para localizar DLLs do sistema). PATHEXT é o que permite
  // ao subprocesso resolver um nome nu (`python3`) para o `.exe`/`.cmd` certo.
  if (process.platform === "win32") {
    permitidas.push(
      "USERPROFILE",
      "TEMP",
      "TMP",
      "USERNAME",
      "APPDATA",
      "LOCALAPPDATA",
      "SYSTEMROOT",
      "PATHEXT",
    );
  }
  const env: Record<string, string> = {};
  for (const nome of permitidas) {
    const v = process.env[nome];
    if (v !== undefined) env[nome] = v;
  }
  // r4/r5: as variáveis de cache do Hugging Face entram pela FUNÇÃO ÚNICA
  // compartilhada (modelo-whisper.ts) — sem isto, a instalação baixava o
  // modelo num cache e a transcrição lia noutro: com
  // HF_HOME/HUGGINGFACE_HUB_CACHE/XDG_CACHE_HOME definidos, o 1º vídeo
  // baixava ~1,6 GB de novo ou falhava sem rede. São CAMINHOS, não
  // credenciais — HF_TOKEN segue fora desta lista para sempre.
  Object.assign(env, ambienteCacheModelo());
  return env as NodeJS.ProcessEnv;
}
