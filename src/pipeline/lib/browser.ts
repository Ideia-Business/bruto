import { chromium, type Browser } from "playwright";
import { registrarAcaoDeCancelamento } from "@/pipeline/lib/cancelamento";
import { garantirChromium } from "@/pipeline/lib/ferramentas";

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
    registrarBrowserParaCancelamento(existing);
    return existing;
  }
  // Modo pacote: o Chromium headless baixa no primeiro export (contrato do
  // instalador) — garante antes de lançar. Modo clone: no-op, igual a hoje.
  await garantirChromium();
  const browser = await chromium.launch({ headless: true });
  // O browser quente precisa NOTAR que fechou (cancelamento de job o fecha):
  // sem isto o global seguraria um browser morto para sempre.
  browser.on("disconnected", () => {
    if (globalForBrowser.__resumeVideoBrowser === browser) {
      globalForBrowser.__resumeVideoBrowser = undefined;
    }
  });
  globalForBrowser.__resumeVideoBrowser = browser;
  registrarBrowserParaCancelamento(browser);
  return browser;
}

/**
 * O Chromium é o subprocesso mais pesado do pipeline (export). É compartilhado
 * (quente) entre jobs, mas cada job que o usa registra a AÇÃO de cancelamento
 * no contexto DELE: cancelar o job chama `browser.close()` — a API pública
 * suportada do Playwright para parar o Chromium — e todo render em andamento
 * rejeita (o job vira `canceled`). O `disconnected` limpa o global, e o
 * próximo job relança o browser sozinho em `getBrowser()`.
 *
 * Nota: `Browser.process()` NÃO existe no `Browser` do Playwright (só no
 * `BrowserServer` de `launchServer()`) — registro via ChildProcess aqui era
 * no-op silencioso; foi removido (INVARIANTE E1: registro que não pode surtir
 * efeito falha alto, e este sempre pode: `close()` é API estável e tipada).
 */
function registrarBrowserParaCancelamento(browser: Browser): void {
  registrarAcaoDeCancelamento(() => {
    // Fechar browser já fechado rejeita — e o objetivo (desconectado) já foi
    // alcançado, então o silêncio aqui é o estado final desejado.
    void browser.close().catch(() => {});
  });
}

/** Fecha o browser (chamado no shutdown; opcional). */
export async function closeBrowser(): Promise<void> {
  const b = globalForBrowser.__resumeVideoBrowser;
  globalForBrowser.__resumeVideoBrowser = undefined;
  if (b && b.isConnected()) {
    await b.close();
  }
}
