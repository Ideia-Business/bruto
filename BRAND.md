# Como o Bruto fala

Este documento existe para uma coisa prática: **manter os nomes iguais** no código, na interface, nas mensagens de erro e na documentação. Quando "aula" vira "resumo detalhado" num lugar e "conteúdo gerado" noutro, quem lê o código para de entender o produto — e quem usa o produto para de entender a tela.

Se você vai contribuir, os dois blocos abaixo são o que importa. Não precisa decorar; consulte quando for nomear algo.

## Léxico

Use estes nomes. Sinônimo circulando é dívida.

| Termo | O que é | Evite |
|---|---|---|
| **Bruto** | O material que entra: o vídeo cru, com link, duração e bagunça. Sempre o **input**, nunca o produto | asset, conteúdo-fonte |
| **Destrinchar** | O verbo do projeto: pegar um bruto e abrir em partes compreensíveis | processar, analisar, gerar |
| **Fala** | A transcrição literal, com marcação de tempo. O que foi dito, sem interpretação | transcript, legenda |
| **Mapa** | O mapa mental — mostra o **formato** da ideia, não o conteúdo dela | mindmap, diagrama |
| **Aula** | A saída principal: objetivos, conceitos do zero, glossário, fixação. É **construída**, não extraída | resumo detalhado, conteúdo gerado |
| **Fixação** | O teste ao fim da Aula. Existe para revelar o que **não** se aprendeu, não para dar nota | quiz, avaliação |
| **Faísca** | Ideia própria de quem usa, capturada no instante em que o conteúdo a provocou. É dela, não do Bruto | nota, insight |
| **Caderno de Ideias** | Onde as faíscas ficam | workspace, biblioteca |
| **Bancada** | A área de trabalho: brutos em fila, destrinchados, caderno | painel, dashboard, home |
| **Sua Chave** | A chave de IA de quem usa. É o modo padrão | API key, token |

## Tom

Vale para texto de interface, mensagem de erro, README e resposta de issue.

| Princípio | Assim | Não assim |
|---|---|---|
| Direto, não ríspido | "Esse vídeo tem 2h47. A aula tem 14 minutos e cobre o que importa." | "Você perdeu 2h47 assistindo lixo." |
| Concreto, não vago | "Transcreve áudio de Reels e TikTok mesmo sem legenda." | "Suporte avançado com tecnologia de ponta." |
| Franco sobre limite | "Áudio ruim gera transcrição ruim. A gente marca os trechos duvidosos em vez de inventar." | "Resultados podem variar conforme a fonte." |
| Fala de oficina | "Joga o link na bancada e vai fazer um café." | "Faça upload do seu asset e deixe nossa engine processar." |

Segunda pessoa, voz ativa, frase curta. No máximo um emoji por peça. Exclamação, praticamente nunca.

**Mensagem de erro** diz o que aconteceu e o que fazer — sem pedir desculpa e sem vaguidão. `NO_TRANSCRIPT` não é "algo deu errado": é *"esse vídeo não tem legenda e o Whisper não está instalado. Rode `npm run doctor`."*

## O nome, em duas linhas

**Bruto é o material que entra, não a qualidade da ferramenta.** Matéria-prima existe para ser transformada — o nome carrega o antes e deixa o depois implícito. Daí a tagline: *entra bruto, sai entendido*.

Se um texto seu deixa alguém achando que "bruto" descreve o software, ele precisa de outra volta.

## Visual, se você for mexer em tela

Estrutura à vista: superfícies chapadas, bordas de 1px reais, contraste alto. Sem gradiente decorativo, sem sombra, sem mascote.

| Papel | Claro | Escuro |
|---|---|---|
| Fundo | `#F5F2EC` | `#141210` |
| Superfície | `#E6E1D7` | `#1E1B18` |
| Texto | `#17140F` | `#EDE8DF` |
| Texto secundário | `#6B655C` | `#9A938A` |
| Acento | `#E14A18` | `#FF6B35` |
| Erro | `#B32D0F` | `#FF7A5C` |
| Sucesso | `#4A6B3D` | `#8FBF77` |
| Aviso | `#8A6B1F` | `#D9A93A` |

O tema escuro muda a **luminância**, nunca a semântica: nenhuma cor nova entra, nenhuma sai.

Tipografia — todas com licença aberta: **Archivo** (interface), **Archivo Black** (títulos), **Source Serif 4** (corpo da Aula, transcrição, exports), **JetBrains Mono** (código e timestamps).

A regra que vale mais que as outras: **a ferramenta se opera em grotesca; a aula se lê em serifa.** Quando alguém entra no modo Estudar e a tipografia muda, o corpo entende antes da cabeça que saiu de um app e entrou numa aula.
