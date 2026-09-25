// `npm run app` em qualquer sistema: escolhe o launcher nativo e repassa a
// saída. No Windows não há bash por padrão; no macOS e no Linux não há
// PowerShell. A lógica de verdade vive em serve.sh e serve.ps1 — aqui só a porta.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const [cmd, args] =
  process.platform === "win32"
    ? ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(aqui, "serve.ps1")]]
    : ["bash", [path.join(aqui, "serve.sh")]];

const r = spawnSync(cmd, args, { stdio: "inherit" });
process.exit(r.status ?? 1);
