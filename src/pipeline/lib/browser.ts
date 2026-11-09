import { chromium, type Browser } from "playwright";
import type { ChildProcess } from "node:child_process";
import { registrarFilho } from "@/pipeline/lib/cancelamento";

/**
 * Instância Chromium headless compartilhada (warm) — usada para renderizar o
 * mapa mental (SVG/PNG) e imprimir o PDF. Vive em globalThis para sobreviver ao
 * hot reload e ser reaproveitada entre etapas/jobs.
 */
const globalForBrowser = globalThis as unknown as {
  __resumeVideoBrowser?: Browser;
};

export async function getBrowser(): Promise<Browser> {
  const existing = globalForBrowser.__resumeVideoBrowser;
  if (existing && existing.isConnected()) {
    registrarFilhoDoBrowser(existing);
    return existing;
  }
  const browser = await chromium.launch({ headless: true });
  globalForBrowser.__resumeVideoBrowser = browser;
  registrarFilhoDoBrowser(browser);
  return browser;
}

/**
 * O Chromium é o subprocesso mais pesado do pipeline (export). É compartilhado
 * (quente) entre jobs, mas cada job que o usa o REGISTRA no contexto DELE:
 * cancelar o job mata o browser em uso — a chamada de render em andamento
 * rejeita, o job vira `canceled`, e o próximo job relança o browser sozinho.
 * Fora de job, o registro global vale para a limpeza de shutdown.
 */
function registrarFilhoDoBrowser(browser: Browser): void {
  // `process()` existe em runtime (documentado pelo playwright) mas não consta
  // no tipo `Browser` desta versão — daí o recorte estrutural em vez de cast
  // solto no objeto inteiro.
  const comProcesso = browser as unknown as { process?: () => ChildProcess | null };
  const proc = comProcesso.process?.();
  if (proc) registrarFilho(proc);
}

/** Fecha o browser (chamado no shutdown; opcional). */
export async function closeBrowser(): Promise<void> {
  const b = globalForBrowser.__resumeVideoBrowser;
  if (b) {
    await b.close();
    globalForBrowser.__resumeVideoBrowser = undefined;
  }
}
