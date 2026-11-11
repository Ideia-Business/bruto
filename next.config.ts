import type { NextConfig } from "next";

// O modo clone (curl | bash) NÃO pode mudar de comportamento (INVARIANTE P2 do
// contrato do instalador): por padrão esta config é vazia — build e `next start`
// idênticos aos de sempre. O `output: "standalone"` (e o que só ele precisa)
// entra SOMENTE quando o instalador do pacote macOS pede, com
// BRUTO_BUILD_STANDALONE=1 — provável em scripts/instalador-macos/construir.sh.
const nextConfig: NextConfig = {};

if (process.env.BRUTO_BUILD_STANDALONE === "1") {
  nextConfig.output = "standalone";
  // better-sqlite3 é addon nativo (não pode ser bundled — o binário tem de
  // chegar inteiro ao node_modules do standalone, compilado para o Node que o
  // pacote carrega) e o playwright só é usado por trás de caminhos absolutos
  // (BRUTO_PLAYWRIGHT_CLI): externos e copiados pelo tracing.
  nextConfig.serverExternalPackages = ["better-sqlite3", "playwright"];
  nextConfig.outputFileTracingIncludes = {
    // migrações/seed do boot em modo pacote (cwd = …/Resources/app)
    "/**": ["./drizzle/**/*", "./node_modules/playwright/**/*"],
  };
}

export default nextConfig;
