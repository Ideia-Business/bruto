/**
 * Provedor: Claude Code CLI (`claude -p`).
 *
 * Autentica pela sessão já configurada na máquina — nenhuma chave de API
 * transita. É o caminho de menor atrito para quem já usa o Claude Code, e o
 * único provedor com busca web nesta versão.
 *
 * Flags (validadas contra `claude --help`):
 *  -p / --print                one-shot, imprime e sai
 *  --output-format json        objeto com { subtype, is_error, result }
 *  --model <alias>             sonnet | haiku | opus
 *  --tools ""                  desabilita TODAS as ferramentas → só texto
 *  --no-session-persistence    não grava sessão em disco
 *  --strict-mcp-config         ignora MCP do ambiente (startup rápido)
 *  --disable-slash-commands    desabilita skills/slash-commands
 *
 * Nota sobre aninhamento: quando isto roda DENTRO de uma sessão Claude Code, o
 * env traz CLAUDECODE=1 e CLAUDE_CODE_*. Verificado empiricamente que a chamada
 * aninhada funciona com essas variáveis presentes, por isso herdamos o env
 * completo — removê-las arriscaria descartar o que sustenta a autenticação.
 */

import { spawn } from "node:child_process";
import { ENV_SENSIVEIS, redact } from "../redact";
import type { LlmCapability, LlmProvider, LlmRequest, LlmResult } from "../types";

/**
 * Métodos de autenticação que consomem o PLANO. Medido nesta estação (Claude
 * Code 2.1.269) com `claude auth status --json`:
 *
 *   plano   exit 0  {"loggedIn": true,  "authMethod": "claude.ai"}
 *   chave   exit 0  {"loggedIn": true,  "authMethod": "api_key"}
 *   nenhum  exit 1  {"loggedIn": false, "authMethod": "none"}
 *
 * Allowlist de propósito: o que não está aqui é tratado como "não é plano".
 */
const AUTH_DE_PLANO = ["claude.ai"];

const MODELO: Record<string, string> = {
  fast: "haiku",
  balanced: "sonnet",
  deep: "opus",
};

function semChavesDeOutros(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const nome of ENV_SENSIVEIS) delete env[nome];
  return env;
}

interface Saida {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

function executar(args: string[], input: string | undefined, timeoutMs: number): Promise<Saida> {
  return new Promise((resolve, reject) => {
    // Aqui o env COMPLETO é necessário: a autenticação do Claude Code vem da
    // sessão local, e não sabemos com certeza quais variáveis a sustentam —
    // podar às cegas arriscaria quebrar o login. O que SIM se pode tirar, e se
    // tira, são as chaves dos OUTROS provedores: se alguém configurou OpenAI no
    // .env e está usando o CLI, não há razão para o processo filho enxergar
    // aquela chave. Least-privilege no que dá para provar.
    const child = spawn("claude", args, {
      env: semChavesDeOutros(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString("utf8");
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString("utf8");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err); // ex.: ENOENT (binário ausente)
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });

    // Fecha o stdin imediatamente — evita o aviso "no stdin data received in 3s".
    if (input != null) child.stdin.write(input);
    child.stdin.end();
  });
}

function extrairResultado(stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("saída vazia");

  let obj: unknown;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    throw new Error(`saída não é JSON válido: ${redact(trimmed.slice(0, 200))}`);
  }
  if (typeof obj !== "object" || obj === null) throw new Error("saída não é um objeto");

  const rec = obj as Record<string, unknown>;
  if (rec.is_error === true) {
    const detalhe = typeof rec.result === "string" ? redact(rec.result) : "";
    throw new Error(`o CLI retornou erro (${String(rec.subtype)}): ${detalhe}`);
  }
  if (typeof rec.result !== "string") throw new Error("campo 'result' ausente na saída");
  return rec.result;
}

export const claudeCliProvider: LlmProvider = {
  id: "claude-cli",
  label: "Claude Code CLI",
  envVar: null, // autentica pela sessão local — nenhuma chave envolvida

  supports(capability: LlmCapability): boolean {
    return capability === "webSearch";
  },

  /**
   * Quatro estados distintos, cada um com a sua mensagem — porque "presença de
   * binário" não é disponibilidade.
   *
   * A versão anterior disto rodava `claude --version`, que responde exatamente
   * igual com e sem sessão válida: com a sessão expirada, o provedor anunciava
   * "pronto", a extensão dizia "usando o seu plano", e a pessoa só descobria o
   * contrário no meio de uma aula. Quem separa os dois é `claude auth status`,
   * medido nesta estação (Claude Code 2.1.269): `--json` é o default, devolve
   * `loggedIn` e sai 0 quando autenticado, 1 quando não. Não gasta token e não
   * fala com o modelo.
   *
   * Lê-se o `loggedIn` do JSON e usa-se o exit code como rede — se uma versão
   * futura mudar a semântica de um, o outro ainda decide.
   *
   * Detalhe que só aparece medindo: uma `ANTHROPIC_API_KEY` no ambiente também
   * conta como `loggedIn`, com `authMethod: "api_key"`. Mas este provedor PODA
   * essa chave do env do subprocesso (é o caminho do plano, não o da chave), e
   * a checagem roda pelo mesmo `executar`, com o mesmo env podado — então ela
   * mede exatamente as condições da chamada real, e não um ambiente mais
   * generoso que o verdadeiro. Quando é esse o caso, a mensagem aponta o
   * provedor certo em vez de mandar a pessoa fazer um login que ela não quer.
   */
  async availability() {
    let r: Saida;
    try {
      r = await executar(["auth", "status"], undefined, 15_000);
    } catch {
      return {
        ok: false as const,
        reason:
          "o comando `claude` não está no PATH — instale o Claude Code ou escolha outro provedor em BRUTO_LLM_PROVIDER",
      };
    }

    if (r.timedOut) {
      return { ok: false as const, reason: "`claude auth status` não respondeu a tempo" };
    }

    let logado: boolean | null = null;
    let metodo: string | null = null;
    let provedorDaApi: string | null = null;
    try {
      const obj = JSON.parse(r.stdout.trim()) as {
        loggedIn?: unknown;
        authMethod?: unknown;
        apiProvider?: unknown;
      };
      if (typeof obj.loggedIn === "boolean") logado = obj.loggedIn;
      if (typeof obj.authMethod === "string") metodo = obj.authMethod;
      if (typeof obj.apiProvider === "string") provedorDaApi = obj.apiProvider;
    } catch {
      /* sem JSON: decide-se pelo exit code, logo abaixo */
    }

    if (logado === null) {
      // Nem JSON nem contrato conhecido — e aqui NÃO se aceita exit 0 como
      // "pronto". Esta é a mesma regra do ramo de baixo, que antes valia só lá:
      // falhar fechado custa uma mensagem a quem tem plano; falhar aberto custa
      // o dinheiro de quem tem chave. Uma versão que respondesse texto em vez de
      // JSON — ou que escrevesse o JSON no stderr, exatamente a armadilha
      // encontrada no `codex login status` — sairia 0 estando autenticada por
      // CHAVE DE API, e este provedor anunciaria plano enquanto cobrava por
      // token. Só há disponibilidade com confirmação POSITIVA.
      return {
        ok: false as const,
        reason:
          "`claude auth status` não respondeu como esperado — atualize o Claude Code (`claude update`)",
      };
    }

    if (logado === true && r.code === 0) {
      // Estar logado NÃO é estar no plano. Medido: uma ANTHROPIC_API_KEY faz o
      // status devolver `loggedIn: true` com `authMethod: "api_key"` — e aí
      // este provedor, que se anuncia "de plano" porque `envVar === null`,
      // estaria cobrando por token e dizendo que não. Mesma classe do
      // `codex login --with-api-key`; fechada aqui pelo mesmo critério.
      //
      // Allowlist, não deny-list: método desconhecido cai para fora. Falhar
      // fechado custa uma mensagem a quem tem plano; falhar aberto custa o
      // dinheiro de quem tem chave.
      // ACEITAÇÃO POSITIVA, e não recusa por campo errado. A diferença só
      // aparece quando o sinal FALTA — e é aí que mora o fail-open: com
      // `{"loggedIn":true}` e sem os outros dois campos (versão nova que omita
      // metadados, saída parcial), as condições negativas eram todas falsas e
      // chegava-se ao `ok: true`. Medido: as três variações de campo ausente
      // devolviam disponível. Campo que falta é sinal que não existe, e sinal
      // que não existe não confirma nada.
      if (metodo === null || provedorDaApi === null) {
        return {
          ok: false as const,
          reason:
            "`claude auth status` não informou o método de autenticação — não dá para confirmar que a sessão é de plano; atualize o Claude Code (`claude update`)",
        };
      }
      if (!AUTH_DE_PLANO.includes(metodo)) {
        return {
          ok: false as const,
          reason:
            metodo === "api_key"
              ? "o Claude Code está autenticado por CHAVE DE API, que cobra por uso — rode `claude auth login` para entrar com o plano, ou use o provedor `anthropic` se a intenção é mesmo pagar por token"
              : `não foi possível confirmar que a sessão do Claude Code é de plano (authMethod: ${metodo}) — rode \`claude auth status\` para ver como você está autenticado`,
        };
      }
      // Bedrock/Vertex cobram por token pela conta de nuvem, não pelo plano.
      if (provedorDaApi !== "firstParty") {
        return {
          ok: false as const,
          reason: `o Claude Code está apontado para ${provedorDaApi}, que cobra por uso e não pelo plano — use o provedor correspondente em BRUTO_LLM_PROVIDER`,
        };
      }
      return { ok: true as const };
    }

    // A presença é conferida pelo NOME da variável; o valor nunca é lido.
    const temChaveAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
    return {
      ok: false as const,
      reason: temChaveAnthropic
        ? "o Claude Code está instalado mas sem sessão — rode `claude auth login`, ou use o provedor `anthropic`, que é o caminho da chave de API que você já tem"
        : "o Claude Code está instalado mas sem sessão — rode `claude auth login` para usar seu plano",
    };
  },

  async run(req: LlmRequest, timeoutMs: number): Promise<LlmResult> {
    const model = MODELO[req.tier ?? "balanced"];
    const querBusca = req.requires?.includes("webSearch") ?? false;

    // Mesma classe do codex-cli: medido que `claude -p "--version"` imprimia
    // `2.1.269 (Claude Code)` em vez de chamar o modelo. O prompt vai depois
    // do terminador `--`, sempre.
    const args = [
      "-p",
      "--output-format",
      "json",
      "--model",
      model,
      ...(querBusca ? ["--allowed-tools", "WebSearch"] : ["--tools", ""]),
      "--no-session-persistence",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--",
      req.prompt,
    ];

    const r = await executar(args, req.input, timeoutMs);

    if (r.timedOut) throw new Error(`tempo esgotado após ${timeoutMs}ms`);
    if (r.code !== 0) {
      // O stderr do CLI pode conter caminho e contexto; redigir antes de propagar.
      const detalhe = redact(r.stderr.trim().slice(0, 300));
      throw new Error(`o CLI saiu com código ${String(r.code)}${detalhe ? `: ${detalhe}` : ""}`);
    }

    return { text: extrairResultado(r.stdout), provider: "claude-cli", model };
  },
};
