import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Padrão do eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Build da extensão: código gerado, não fonte.
    "extension/dist/**",

    // Pacote do servidor do modo grátis: gerado por scripts/build-servidor.mjs.
    "servidor/.payload/**",

    // Worktrees por assunto (`.wt/<assunto>`, criados por `worktree-lane.sh`).
    // São CÓPIAS inteiras deste mesmo repositório dentro dele. O git já as
    // ignora (`.git/info/exclude`), mas o eslint tem lista própria: sem esta
    // linha, `npm run lint` na raiz varre cada lane aberta e acusa milhares de
    // problemas — inclusive em `src/components/ui/**`, que é ignorado só no
    // caminho de cima. Medido: com 3 lanes abertas, 18.471 achados, 100% deles
    // dentro de `.wt/` e nenhum no código versionado. Gate que reprova código
    // são é pior que gate nenhum, porque ensina a ignorar o vermelho.
    ".wt/**",

    // Componentes do shadcn/ui. São código de terceiro COPIADO para dentro do
    // repositório (é assim que o shadcn funciona — não é dependência). Corrigir
    // lint aqui significa divergir do upstream e brigar com o próximo `shadcn add`.
    // O que é NOSSO fica em src/components/, um nível acima.
    "src/components/ui/**",
  ]),

  {
    rules: {
      // `_algo` significa "existe porque a assinatura exige, e não é usado de
      // propósito" — convenção universal que o padrão do TS-ESLint não conhece.
      // Sem isto, implementar uma interface gera aviso em todo parâmetro ignorado.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
]);

export default eslintConfig;
