/**
 * doctor — checa as dependências de sistema do pipeline.
 *   npm run doctor
 * Exit 0 se o essencial (yt-dlp, ffmpeg, claude) está presente.
 */
import { spawnSync } from "node:child_process";
import { vtDoctor, isVtAvailable, VT_SH_PATH } from "@/pipeline/lib/vt-bridge";

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
    checkBin("claude", ["--version"], true),
    checkBin("uv", ["--version"], false),
  ];

  // vt.sh / whisper (fallback de transcrição) — opcional mas recomendado.
  const vt = await vtDoctor();
  checks.push({
    name: "vt.sh (whisper)",
    ok: isVtAvailable() && vt.ok,
    detail: isVtAvailable() ? vt.output.split("\n")[0] || "ok" : "vt.sh ausente (Tier whisper off)",
    essential: false,
  });

  console.log("\n🩺 Resume_Video — doctor\n");
  let essentialFail = false;
  for (const c of checks) {
    const icon = c.ok ? "✅" : c.essential ? "❌" : "⚠️ ";
    console.log(`  ${icon} ${c.name.padEnd(18)} ${c.detail}`);
    if (!c.ok && c.essential) essentialFail = true;
  }
  if (VT_SH_PATH) console.log(`\n  vt.sh: ${VT_SH_PATH}`);

  if (essentialFail) {
    console.log("\n✖ Faltam dependências essenciais. Instale:");
    console.log("    brew install yt-dlp ffmpeg");
    console.log("    (claude: já vem com o Claude Code)\n");
    process.exit(1);
  }
  console.log("\n✔ Ambiente pronto para processar vídeos.\n");
  process.exit(0);
}

void main();
