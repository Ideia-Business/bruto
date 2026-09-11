/**
 * doctor — checa as dependências de sistema do pipeline.
 *   npm run doctor
 * Exit 0 se o essencial está presente: yt-dlp, ffmpeg e ALGUM provedor de IA.
 *
 * O `claude` deixou de ser dependência obrigatória: agora é um provedor entre
 * seis. O que o doctor exige é que exista pelo menos um caminho para o modelo.
 */
import { spawnSync } from "node:child_process";
import { transcricaoDoctor, detectarBackend } from "@/pipeline/lib/transcribe";
import { listarProvedores, resolverProvedor } from "@/pipeline/lib/llm";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  essential: boolean;
}

function checkBin(bin: string, args: string[], essential: boolean): Check {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  const ok = r.status === 0 && !r.error;
  const detail = ok ? (r.stdout || r.stderr).trim().split("\n")[0] : "não encontrado no PATH";
  return { name: bin, ok, detail, essential };
}

async function main(): Promise<void> {
  const checks: Check[] = [
    checkBin("yt-dlp", ["--version"], true),
    checkBin("ffmpeg", ["-version"], true),
    checkBin("uv", ["--version"], false),
  ];

  // Transcrição local (fallback quando não há legenda) — opcional mas é o que
  // faz Instagram e TikTok funcionarem, então o doctor a nomeia por extenso.
  const t = await transcricaoDoctor();
  const backend = await detectarBackend();
  checks.push({
    name: "whisper",
    ok: t.ok,
    detail: t.ok
      ? `backend: ${backend}${t.linhas.length > 1 ? ` (também: ${t.linhas.slice(1).join(", ")})` : ""}`
      : "nenhum transcritor — vídeo sem legenda vai falhar",
    essential: false,
  });

  console.log("\n🩺 Bruto — doctor\n");
  let essentialFail = false;
  for (const c of checks) {
    const icon = c.ok ? "✅" : c.essential ? "❌" : "⚠️ ";
    console.log(`  ${icon} ${c.name.padEnd(18)} ${c.detail}`);
    if (!c.ok && c.essential) essentialFail = true;
  }
  if (!t.ok && t.linhas.length > 0) {
    // Há transcritor instalado mas algo falta (tipicamente o modelo ggml do
    // whisper.cpp). Dizer O QUE existe poupa a caçada.
    console.log(`\n  transcritores encontrados: ${t.linhas.join(", ")}`);
  }

  // Provedores de IA: mostra o estado de todos, exige que UM esteja pronto.
  console.log("\n  Provedores de IA:");
  for (const p of listarProvedores()) {
    const d = await p.availability();
    const icon = d.ok ? "✅" : "  ";
    const detalhe = d.ok ? (p.envVar ? `${p.envVar} definida` : "sessão local") : d.reason;
    console.log(`  ${icon} ${p.label.padEnd(16)} ${detalhe}`);
  }

  let provedorAtivo: string | null = null;
  try {
    const p = await resolverProvedor();
    provedorAtivo = p.label;
  } catch (err) {
    essentialFail = true;
    console.log(`\n  ❌ ${err instanceof Error ? err.message : "nenhum provedor disponível"}`);
  }

  if (essentialFail) {
    console.log("\n✖ Faltam dependências essenciais.");
    console.log("    brew install yt-dlp ffmpeg");
    console.log("    e configure um provedor de IA: cp .env.example .env\n");
    process.exit(1);
  }
  console.log(`\n✔ Ambiente pronto. Modelo via: ${provedorAtivo}\n`);
  process.exit(0);
}

void main();
