/**
 * Provedor: Codex CLI (`codex exec`) — irmão do `claude-cli`.
 *
 * Existe pelo mesmo motivo que ele: consumir a **assinatura que a pessoa já
 * paga** (aqui o plano ChatGPT), em vez de exigir chave de API e cobrar por
 * token. Autentica pelo login guardado em `$CODEX_HOME` (por padrão
 * `~/.codex/auth.json`); nenhuma chave transita por aqui.
 *
 * Flags, TODAS medidas contra o `codex --help` e o `codex exec --help` desta
 * estação (codex-cli 0.153.4, 12/09/2026) — não copiadas de memória:
 *
 *   exec                      subcomando não-interativo
 *   --sandbox read-only       o subprocesso NÃO escreve em disco (valores
 *                             possíveis medidos: read-only, workspace-write,
 *                             danger-full-access)
 *   --ephemeral               não persiste arquivo de sessão
 *   --skip-git-repo-check     permite rodar fora de repositório git — usamos um
 *                             diretório temporário como raiz de trabalho, para
 *                             que o processo sequer enxergue o repo
 *   --json                    eventos em JSONL no stdout (capturável, estável)
 *   --color never             sem escape ANSI sujando o texto
 *   -c model_reasoning_effort=…  o botão de TIER (ver abaixo)
 *
 * **Tier sem nome de modelo.** O contrato desta camada é "o step pede tier, o
 * provedor escolhe". No Codex o nome do modelo vem da conta e do
 * `~/.codex/config.toml` da pessoa (nesta estação, `gpt-5.6-terra`) — fixar um
 * nome aqui quebraria na máquina de quem usa outro plano. O que É portátil é o
 * esforço de raciocínio, então o tier mapeia para ele e o modelo continua sendo
 * o que a pessoa escolheu.
 *
 * **O exit code não basta como sinal de sucesso.** Medido: sem autenticação, o
 * `codex exec` emite `turn.failed` e onze eventos `error`… e só depois sai com
 * código 1. Um caminho de falha que emitisse `turn.failed` e saísse 0 passaria
 * batido por um `if (code !== 0)`. Por isso o sucesso aqui é afirmativo: exige
 * um item `agent_message` no JSONL. Ausência de resposta é erro, nunca texto
 * vazio devolvido como se fosse resultado.
 */

import { spawn } from "node:child_process";
import os from "node:os";
import { ENV_SENSIVEIS, redact } from "../redact";
import type { LlmCapability, LlmProvider, LlmRequest, LlmResult } from "../types";

/**
 * A ÚNICA forma de autenticação que este provedor aceita, porque é a única que
 * consome o plano em vez de cobrar por token. Formas medidas do
 * `codex login status` (codex-cli 0.153.4, 12/09/2026):
 *
 *   plano   exit 0  "Logged in using ChatGPT"
 *   chave   exit 0  "Logged in using an API key - sk-proj-***0000"
 *   nenhum  exit 1  "Not logged in"
 *
 * E o texto sai em **stderr**, não em stdout — o stdout deste subcomando vem
 * vazio. Casar contra o stdout daria "não confirmei que é plano" para TODO
 * mundo, inclusive quem tem plano: falharia fechado, que é o lado certo de
 * errar, mas desligaria o provedor para quem está certo.
 *
 * O casamento é por ALLOWLIST ancorada, não por procura de substring solta: se
 * um dia o texto mudar, o desconhecido cai no lado "não é plano" e o provedor
 * se declara indisponível. Falhar fechado aqui custa uma mensagem a mais para
 * quem tem plano; falhar aberto custa o dinheiro de quem tem chave.
 */
const AUTH_DE_PLANO = /^logged in using chatgpt\b/im;

/** Tier → esforço de raciocínio. Portátil: independe do nome do modelo. */
const ESFORCO: Record<string, string> = {
  fast: "low",
  balanced: "medium",
  deep: "high",
};

/**
 * O env do filho vai sem as chaves dos OUTROS provedores: este caminho é o do
 * PLANO, e uma chave de API visível aqui só poderia levar a cobrança por token
 * — exatamente o que este provedor existe para evitar. O resto do ambiente é
 * herdado porque é dele que sai a autenticação (`CODEX_HOME`, `HOME`, `PATH`).
 */
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
    const child = spawn("codex", args, {
      // Raiz de trabalho fora do repositório: com `--sandbox read-only` ele já
      // não escreveria, mas não custa nada também não lhe dar o repo para ler.
      cwd: os.tmpdir(),
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

    if (input != null) child.stdin.write(input);
    child.stdin.end();
  });
}

interface EventoJsonl {
  type?: string;
  item?: { type?: string; text?: string; message?: string };
  error?: { message?: string };
  message?: string;
}

function linhasJson(stdout: string): EventoJsonl[] {
  const eventos: EventoJsonl[] = [];
  for (const linha of stdout.split("\n")) {
    const t = linha.trim();
    if (!t.startsWith("{")) continue; // o CLI também escreve log solto; ignoramos
    try {
      eventos.push(JSON.parse(t) as EventoJsonl);
    } catch {
      /* linha truncada ou não-JSON: não é evento, segue */
    }
  }
  return eventos;
}

/**
 * O modelo vem do `~/.codex/config.toml` de quem usa, e este provedor não tem
 * como validá-lo antes da hora — medido: com um modelo que a conta não aceita,
 * `codex doctor` sai **0** e reporta "0 fail", então ele é falso-verde e não
 * serve de pré-voo; a única validação de verdade é gerar, que custa token e
 * tempo demais para caber num teste de disponibilidade.
 *
 * O que dá para fazer, e é o que se faz aqui: quando a falha É essa, dizer onde
 * mexer. Sem isto a pessoa recebe um 400 cru do outro lado da aula e não tem
 * como saber que o problema é uma linha de config dela.
 */
function explicarSePorConfig(detalhe: string): string {
  if (/not supported when using Codex|Model metadata for|model.*not supported/i.test(detalhe)) {
    return `${detalhe}\n→ O modelo configurado não serve para esta conta. Confira a linha \`model\` em ~/.codex/config.toml (ou rode \`codex doctor\` para ver qual está valendo).`;
  }
  if (/ReasoningEffortParam|reasoning\.effort/i.test(detalhe)) {
    return `${detalhe}\n→ O modelo configurado não aceita esforço de raciocínio. Escolha um modelo da família Codex em ~/.codex/config.toml.`;
  }
  return detalhe;
}

/**
 * Extrai a resposta. Formato medido:
 *   {"type":"item.completed","item":{"type":"agent_message","text":"..."}}
 * e, no caminho de falha:
 *   {"type":"turn.failed","error":{"message":"..."}}
 */
function extrairResultado(stdout: string): string {
  const eventos = linhasJson(stdout);

  const falha = eventos.find((e) => e.type === "turn.failed");
  if (falha) {
    const detalhe = redact(String(falha.error?.message ?? "sem detalhe"));
    throw new Error(`o turno falhou: ${explicarSePorConfig(detalhe)}`);
  }

  const mensagens = eventos.filter(
    (e) => e.type === "item.completed" && e.item?.type === "agent_message",
  );
  const ultima = mensagens[mensagens.length - 1]?.item?.text;
  if (typeof ultima !== "string" || ultima.trim() === "") {
    const erro = eventos.find((e) => e.type === "error")?.message;
    throw new Error(
      erro
        ? `nenhuma resposta do agente: ${redact(erro)}`
        : "nenhuma resposta do agente na saída do CLI",
    );
  }
  return ultima;
}

export const codexCliProvider: LlmProvider = {
  id: "codex-cli",
  label: "Codex CLI (plano ChatGPT)",
  envVar: null, // autentica pelo login local — nenhuma chave envolvida

  supports(_capability: LlmCapability): boolean {
    // Busca web não foi verificada neste caminho não-interativo, e declarar
    // capacidade que não se mediu é pior que não tê-la: o `runLLM` lança
    // LLM_CAPABILITY e o step decide, em vez de receber resposta sem busca
    // achando que houve busca.
    return false;
  },

  /**
   * Três estados distintos, com mensagem própria para cada um — porque
   * "presença de binário" não é disponibilidade, e a mensagem certa é a
   * diferença entre a pessoa instalar algo ou apenas fazer login.
   *
   * O que este teste NÃO cobre, e é honesto dizer: se o `config.toml` da pessoa
   * apontar para um modelo que a conta dela não aceita, isto aqui responde
   * `ok` e a falha só aparece na primeira geração. Não é descuido — é que não
   * existe pré-voo barato: `codex doctor` sai 0 e diz "0 fail" nesse mesmo
   * cenário (medido), e a única verificação de verdade seria gerar, que custa
   * token e segundos a cada consulta de disponibilidade. O que se faz em troca
   * é o erro de runtime apontar a linha de config — ver `explicarSePorConfig`.
   */
  async availability() {
    let r: Saida;
    try {
      r = await executar(["login", "status"], undefined, 15_000);
    } catch {
      return {
        ok: false as const,
        reason:
          "o comando `codex` não está no PATH — instale o Codex CLI (`npm i -g @openai/codex`) ou escolha outro provedor em BRUTO_LLM_PROVIDER",
      };
    }
    if (r.timedOut) {
      return { ok: false as const, reason: "`codex login status` não respondeu a tempo" };
    }
    if (r.code !== 0) {
      // Medido: sem login, imprime "Not logged in" e sai 1.
      return {
        ok: false as const,
        reason: "o Codex CLI está instalado mas sem login — rode `codex login` para usar seu plano",
      };
    }

    // Exit 0 NÃO basta: `codex login --with-api-key` também sai 0. Se
    // aceitássemos qualquer exit 0, este provedor — que se anuncia como "de
    // plano" porque `envVar === null` — passaria a queimar a chave de API da
    // pessoa por token, dizendo a ela que estava usando a assinatura. É a
    // mentira exata que o provedor existe para eliminar.
    const statusTexto = `${r.stderr}\n${r.stdout}`.trim();
    if (!AUTH_DE_PLANO.test(statusTexto)) {
      return {
        ok: false as const,
        // A saída do comando NUNCA entra nesta mensagem: ela ecoa a chave
        // mascarada ("Logged in using an API key - sk-proj-***0000"), e chave
        // mascarada continua sendo material de credencial.
        reason: /api key/i.test(statusTexto)
          ? "o Codex está autenticado por CHAVE DE API, que cobra por uso — rode `codex login` para entrar com o plano ChatGPT, ou use o provedor `openai` se a intenção é mesmo pagar por token"
          : "não foi possível confirmar que o login do Codex é por plano — rode `codex login status` para ver como você está autenticado",
      };
    }
    return { ok: true as const };
  },

  async run(req: LlmRequest, timeoutMs: number): Promise<LlmResult> {
    const esforco = ESFORCO[req.tier ?? "balanced"];

    // O `req.prompt` vem DEPOIS de `--`, e nunca antes das flags. Medido: com o
    // prompt na frente, `codex exec "--version"` imprimia `codex-cli-exec
    // 0.153.4` e o modelo nunca era chamado — ou seja, texto de fora virava
    // flag do CLI, inclusive a que pula a sandbox, num processo que herda
    // HOME e CODEX_HOME. Com o terminador, chega como texto.
    const args = [
      "exec",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--skip-git-repo-check",
      "--json",
      "--color",
      "never",
      "-c",
      `model_reasoning_effort=${esforco}`,
      "--",
      req.prompt,
    ];

    const r = await executar(args, req.input, timeoutMs);

    if (r.timedOut) throw new Error(`tempo esgotado após ${timeoutMs}ms`);

    // O texto vem primeiro: um `turn.failed` no JSONL é diagnóstico melhor que
    // o número do exit, e queremos ele mesmo quando o código é diferente de 0.
    try {
      const text = extrairResultado(r.stdout);
      return {
        text,
        provider: "codex-cli",
        // O CLI não reporta o modelo, e ele vem da conta/config de quem usa.
        // Registrar o esforço é o que há de honesto e útil para diagnóstico.
        model: `codex:${esforco}`,
      };
    } catch (err) {
      const detalhe = redact(r.stderr.trim().slice(0, 300));
      const causa = err instanceof Error ? err.message : "falha desconhecida";
      throw new Error(`${causa}${detalhe ? ` · stderr: ${detalhe}` : ""}`);
    }
  },
};
