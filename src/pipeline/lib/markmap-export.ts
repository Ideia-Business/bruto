import fs from "node:fs";
import path from "node:path";
import { Transformer } from "markmap-lib";
import { getBrowser } from "./browser";

/**
 * Renderiza o mapa mental (markdown hierárquico) para SVG e PNG usando o
 * Chromium headless. O markmap não tem export oficial de imagem (issue #66):
 * transformamos no Node, injetamos o bundle browser do markmap-view numa página
 * e capturamos o resultado. Fundo BRANCO + texto escuro (default do markmap),
 * para o PNG ficar legível quando embutido nos documentos (docx/pdf claros).
 */

const MARKMAP_BROWSER_BUNDLE = path.join(
  process.cwd(),
  "node_modules",
  "markmap-view",
  "dist",
  "browser",
  "index.js",
);

// O bundle browser do markmap-view é UMD e espera `d3` global — injetamos antes.
const D3_BUNDLE = path.join(process.cwd(), "node_modules", "d3", "dist", "d3.min.js");

const transformer = new Transformer();

export interface MindmapImages {
  svgPath: string;
  pngPath: string;
}

export async function renderMindmap(
  markdown: string,
  out: MindmapImages,
): Promise<MindmapImages> {
  const { root } = transformer.transform(markdown);
  const d3Bundle = fs.readFileSync(D3_BUNDLE, "utf8");
  const bundle = fs.readFileSync(MARKMAP_BROWSER_BUNDLE, "utf8");

  const browser = await getBrowser();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  try {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.setContent(
      `<!doctype html><html><head><meta charset="utf-8">
       <style>
         html,body{margin:0;padding:0;background:#ffffff;}
         #mm{width:1600px;height:1000px;display:block;}
         .markmap-node text,.markmap-foreign{fill:#1f2937;color:#1f2937;
           font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;}
       </style></head>
       <body><svg id="mm"></svg></body></html>`,
      { waitUntil: "load" },
    );
    await page.addScriptTag({ content: d3Bundle });
    await page.addScriptTag({ content: bundle });

    // Cria o markmap (tudo expandido), guarda a instância e mede o conteúdo.
    const box = await page.evaluate((data: unknown) => {
      const w = window as unknown as {
        markmap: { Markmap: { create: (el: string, opts: unknown, data: unknown) => unknown } };
        __mm: { fit: () => void };
      };
      const mm = w.markmap.Markmap.create(
        "#mm",
        { initialExpandLevel: -1, maxWidth: 260, duration: 0, spacingVertical: 8 },
        data,
      ) as { fit: () => void };
      w.__mm = mm;
      mm.fit();
      const g = document.querySelector("#mm g") as SVGGraphicsElement | null;
      if (!g) return null;
      const bb = g.getBBox();
      return { w: Math.ceil(bb.width), h: Math.ceil(bb.height) };
    }, root);

    // Ajusta o SVG ao tamanho real do conteúdo (com margem) e reenquadra.
    const W = box ? Math.max(900, box.w + 100) : 1600;
    const H = box ? Math.max(560, box.h + 100) : 1000;
    await page.setViewportSize({ width: W, height: H });
    await page.evaluate((size: { W: number; H: number }) => {
      const svg = document.querySelector("#mm") as SVGSVGElement;
      svg.style.width = `${size.W}px`;
      svg.style.height = `${size.H}px`;
      const w = window as unknown as { __mm?: { fit: () => void } };
      w.__mm?.fit();
    }, { W, H });
    await page.waitForTimeout(350);

    // SVG standalone com estilo mínimo embutido.
    const svgMarkup = await page.evaluate(() => {
      const svg = document.querySelector("#mm") as SVGSVGElement;
      return svg.outerHTML;
    });
    const svgStandalone = svgMarkup.replace(
      /<svg([^>]*)>/,
      `<svg$1 xmlns="http://www.w3.org/2000/svg"><style>.markmap-foreign{color:#1f2937;font-family:sans-serif}text{fill:#1f2937}</style>`,
    );
    fs.writeFileSync(out.svgPath, svgStandalone);

    // PNG: screenshot do elemento SVG (fundo branco garantido pelo body).
    const el = await page.$("#mm");
    if (el) await el.screenshot({ path: out.pngPath, type: "png" });
    else await page.screenshot({ path: out.pngPath, type: "png", fullPage: true });
  } finally {
    await page.close();
  }

  return out;
}
