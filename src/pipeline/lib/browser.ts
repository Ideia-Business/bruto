import { chromium, type Browser } from "playwright";

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
  if (existing && existing.isConnected()) return existing;
  const browser = await chromium.launch({ headless: true });
  globalForBrowser.__resumeVideoBrowser = browser;
  return browser;
}

/** Fecha o browser (chamado no shutdown; opcional). */
export async function closeBrowser(): Promise<void> {
  const b = globalForBrowser.__resumeVideoBrowser;
  if (b) {
    await b.close();
    globalForBrowser.__resumeVideoBrowser = undefined;
  }
}
