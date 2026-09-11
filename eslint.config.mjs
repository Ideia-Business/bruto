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
