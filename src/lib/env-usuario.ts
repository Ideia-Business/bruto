/**
 * env-usuario.ts — o `.env` DA PESSOA no app empacotado.
 *
 * No modo clone, quem desenvolve edita o `.env` do checkout (os scripts o
 * carregam com `--env-file-if-exists`). No app empacotado NÃO EXISTE `.env`
 * editável: o do checkout é segredo da máquina de build e não viaja no
 * pacote. O equivalente do pacote é `$BRUTO_DATA_ROOT/.env` (default
 * `~/.bruto/.env`), criado pela própria pessoa e lido UMA vez no boot
 * (`instrumentation.ts`, mesmo ponto da migração).
 *
 * Regras (contrato do brief de integração):
 *
 *  - SÓ modo pacote. No clone é no-op: o comportamento histórico não muda.
 *  - NUNCA sobrescreve variável já definida no ambiente — o lançador e o
 *    shell da pessoa vencem o arquivo.
 *  - SÓ entram as variáveis que o app CONHECE (`VARIAVEIS_CONHECIDAS`):
 *    as chaves dos provedores de IA e as `BRUTO_*` de configuração que o
 *    app lê. Desconhecida é ignorada — o arquivo não vira vetor de injeção
 *    de ambiente. As variáveis do contrato do lançador (`BRUTO_EMPACOTADO`,
 *    `BRUTO_FERRAMENTAS`, `BRUTO_DATA_ROOT`, `BRUTO_NODE`, `UV_*`…) ficam
 *    de fora DE PROPÓSITO: quem as define é o lançador, e deixar o arquivo
 *    redefini-las quebraria a INVARIANTE DO PACOTE.
 *  - Parser deliberadamente simples: `CHAVE=valor`, comentário `#`, aspas
 *    opcionais. NADA é executado e NADA é expandido — `$(...)` e crases
 *    ficam LITERAIS no valor.
 *  - Arquivo ausente (ou ilegível): silêncio. Permissão aberta a
 *    grupo/outros: carrega e registra UM aviso. O log NUNCA contém valor —
 *    só os NOMES carregados.
 */
import fs from "node:fs";
import os from "node:os";
import { juntarCaminho } from "@/lib/caminho-opaco";

/**
 * As únicas variáveis aceitas do arquivo. As chaves de provedor repetem a
 * lista de `src/pipeline/lib/llm/providers/` de propósito: importar o
 * registro daqui criaria um ciclo (provedor → este módulo → provedores).
 * O teste `tests/lib/env-usuario.test.ts` trava a lista contra
 * `listarProvedores()` — provedor novo sem a chave aqui QUEBRA o teste.
 */
export const VARIAVEIS_CONHECIDAS = [
  // Chaves dos provedores de IA (src/pipeline/lib/llm/providers/*).
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "OLLAMA_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY", // alternativa documentada do Google (google.ts)
  // Escolha de provedor e de modelo por tier (src/pipeline/lib/llm/**).
  "BRUTO_LLM_PROVIDER",
  "BRUTO_MODEL_FAST",
  "BRUTO_MODEL_BALANCED",
  "BRUTO_MODEL_DEEP",
  // Transcrição local (src/pipeline/lib/transcribe.ts).
  "BRUTO_WHISPER_MODEL",
  "BRUTO_WHISPER_CPP_MODEL",
] as const;

const CONHECIDAS: ReadonlySet<string> = new Set(VARIAVEIS_CONHECIDAS);

/**
 * Onde a pessoa edita a configuração, por modo — para os textos de ajuda
 * (razões dos provedores, mensagem de `LLM_NOT_CONFIGURED`, doctor). No
 * pacote o caminho citado é o default do contrato; quem personaliza
 * `BRUTO_DATA_ROOT` sabe onde está o próprio arquivo.
 */
export function alvoEnvUsuario(): string {
  return process.env.BRUTO_EMPACOTADO === "1" ? "~/.bruto/.env" : ".env";
}

/**
 * O caminho real do arquivo: `$BRUTO_DATA_ROOT/.env`, default `~/.bruto/.env`
 * — a mesma regra de `paths.ts`, calculada por CHAMADA (o boot e os testes
 * ajustam `BRUTO_DATA_ROOT` por execução). `juntarCaminho` (não `path.join`)
 * para o tracer do build standalone não varrer o projeto atrás de `*.env*`
 * (ver `caminho-opaco.ts`) — varrer poderia arrastar o `.env` real do
 * checkout para dentro do pacote.
 */
export function caminhoEnvUsuario(): string {
  const raiz = process.env.BRUTO_DATA_ROOT ?? juntarCaminho(os.homedir(), ".bruto");
  return juntarCaminho(raiz, ".env");
}

const RE_PAR = /^([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*(.*)$/;

/**
 * O parser: `CHAVE=valor`, comentário `#`, aspas opcionais (par casado de
 * `"` ou `'`). Linha malformada é ignorada. Nada de `export`, nada de
 * expansão, nada de execução — o valor é SEMPRE um literal.
 */
export function analisarEnv(conteudo: string): Array<[string, string]> {
  const pares: Array<[string, string]> = [];
  for (const linha of conteudo.split(/\r?\n/)) {
    const t = linha.trim();
    if (!t || t.startsWith("#")) continue;
    const m = RE_PAR.exec(t);
    if (!m) continue;
    let valor = m[2].trim();
    if (
      valor.length >= 2 &&
      ((valor.startsWith('"') && valor.endsWith('"')) ||
        (valor.startsWith("'") && valor.endsWith("'")))
    ) {
      valor = valor.slice(1, -1);
    }
    pares.push([m[1], valor]);
  }
  return pares;
}

export interface CargaEnvUsuario {
  /** NOMES carregados (nunca valores) — para log e para o teste. */
  carregadas: string[];
  /** O arquivo tinha permissão aberta a grupo/outros (e o aviso foi logado). */
  avisoPermissao: boolean;
}

const VAZIA: CargaEnvUsuario = { carregadas: [], avisoPermissao: false };

/**
 * Carrega o `.env` da pessoa para o `process.env` do servidor. No-op fora
 * do modo pacote. Nunca lança: um arquivo ruim não pode derrubar o boot.
 * O log (injetável, para teste) recebe no máximo duas linhas — o aviso de
 * permissão e a lista de NOMES carregados — e NUNCA um valor.
 */
export function carregarEnvDoUsuario(
  log: (mensagem: string) => void = (m) => console.log(m),
): CargaEnvUsuario {
  if (process.env.BRUTO_EMPACOTADO !== "1") return VAZIA;

  const arquivo = caminhoEnvUsuario();
  let modo: number;
  let conteudo: string;
  try {
    modo = fs.statSync(arquivo).mode;
    conteudo = fs.readFileSync(arquivo, "utf8");
  } catch {
    return VAZIA; // ausente ou ilegível: silêncio
  }

  const aberto = (modo & 0o077) !== 0;
  if (aberto) {
    log(
      `[bruto] AVISO: ${arquivo} pode ser lido por outros usuários deste Mac. ` +
        `Recomendado: chmod 600 "${arquivo}"`,
    );
  }

  const carregadas: string[] = [];
  for (const [nome, valor] of analisarEnv(conteudo)) {
    if (!CONHECIDAS.has(nome)) continue; // desconhecida: ignorada
    if (process.env[nome] !== undefined) continue; // o ambiente vence o arquivo
    process.env[nome] = valor;
    carregadas.push(nome);
  }
  if (carregadas.length > 0) {
    log(`[bruto] configuração de ${arquivo} aplicada: ${carregadas.join(", ")}`);
  }
  return { carregadas, avisoPermissao: aberto };
}
