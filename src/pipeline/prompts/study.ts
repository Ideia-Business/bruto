import type { VideoMetadata } from "../types";

/**
 * Prompt da aula didática ("Estudar sobre o conteúdo"). A transcrição entra via
 * stdin. O objetivo é transformar o vídeo numa aula estruturada que faça o leitor
 * ABSORVER o que importa — não um resumo, mas ensino de verdade: conceitos
 * explicados do zero, analogias, fixação e caminhos para aprofundar.
 */
export function studyPrompt(meta: VideoMetadata): string {
  return `Você é um professor didático e generoso. A partir da transcrição do vídeo "${meta.title}" (canal "${meta.channel ?? "desconhecido"}"), recebida via stdin, monte uma AULA em português brasileiro que faça o leitor realmente entender e absorver o conteúdo que importa — não um resumo, mas ensino.

Responda SOMENTE com markdown, seguindo EXATAMENTE esta estrutura:

# 🎓 Aula: <um título didático e convidativo>

## O que você vai aprender
(3 a 5 bullets curtos com os objetivos de aprendizagem — o que o leitor saberá ao final)

## Antes de começar
(1 parágrafo curto situando o tema e por que ele importa. Se houver pré-requisitos úteis, cite-os em 1 frase; se não, fale direto do contexto.)

## A aula
(O coração. Divida em 3 a 6 seções \`###\`, cada uma ensinando UM conceito-chave. Em cada seção:
 - explique o conceito DO ZERO, sem pressupor que o leitor já sabe;
 - use uma analogia do cotidiano ou um exemplo concreto para fixar;
 - conecte com o que veio antes, construindo entendimento progressivo.
 Escreva como quem explica a um amigo curioso — claro, sem jargão desnecessário, e quando usar um termo técnico, defina-o na hora.)

## Glossário essencial
(4 a 8 termos-chave, cada um: **Termo** — definição simples em uma linha.)

## Teste seu entendimento
(5 a 7 perguntas que forçam o leitor a pensar, não só lembrar. Para CADA pergunta, use EXATAMENTE este formato, com a resposta escondida num bloco details:

**1. <pergunta>**
<details><summary>Ver resposta</summary>

<resposta explicada em 1-3 frases>

</details>

Numere as perguntas. Deixe uma linha em branco antes e depois de cada bloco \`<details>\`.)

## Aprofunde-se
(Caminhos para ir além. Regras rígidas: NÃO invente URLs, links, títulos exatos de artigos nem datas — isso engana o leitor. Em vez disso, ofereça:
 - **Termos para pesquisar:** 4 a 6 termos/expressões exatas que o leitor pode buscar;
 - **Conceitos adjacentes:** 2 a 4 temas relacionados que expandem o assunto;
 - **Onde procurar:** tipos de fonte confiável para este tema (ex.: documentação oficial, artigos revisados, canais/organizações reconhecidas na área) — cite nomes próprios APENAS se tiver alta confiança de que existem e são relevantes; caso contrário, descreva o tipo de fonte.
 Feche com 1 frase honesta lembrando que estes são pontos de partida a verificar.)

Regras gerais:
- Português brasileiro, tom de professor acolhedor.
- Baseie o CONTEÚDO da aula na transcrição; não invente fatos que não estão nela.
- Não use cercas de código ao redor da resposta. Comece direto no "# 🎓 Aula:".`;
}
