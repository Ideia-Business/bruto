# Bruto — Glossário de Linguagem Ubíqua

O Bruto transforma vídeo em aula. Este glossário fixa os termos de como o conteúdo é
organizado, guardado e encontrado — para não confundir "quem decide" (pessoa ou IA) nem
"quantos por vídeo" (um ou vários).

## Linguagem

**Bruto**:
O material que entra: o vídeo cru, com link, duração e bagunça. Sempre o input, nunca o
produto — o que sai dele (resumo, aula, mapa mental) é o Destrinchado.
_Evite_: vídeo, conteúdo, item

**Categoria**:
Classificação automática, uma por Bruto, escolhida pela IA a partir de uma lista fixa de
nove (Tecnologia, Negócios, Educação, Ciência, Saúde, Finanças, Desenvolvimento Pessoal,
Entretenimento, Outros). É o eixo estável de navegação do Catálogo.
_Evite_: subcategoria, classificação, tipo

**Tag**:
Rótulo automático, vários por Bruto, escolhido pela IA a partir da transcrição inteira, para
filtrar dentro do Catálogo. A IA reaproveita uma Tag já existente na mesma Categoria sempre
que ela servir, e só cria uma nova quando nenhuma existente couber — evita dezenas de rótulos
quase-iguais para o mesmo assunto. Editável pela pessoa. Não tem tela própria: aparece como
filtro dentro do Catálogo.
_Evite_: subcategoria, etiqueta, label

**Filão**:
Agrupamento feito pela pessoa, por assunto que ela escolhe. Distinto de Categoria (que a IA
escolhe, uma por Bruto) e de Tag (que a IA escolhe, várias por Bruto, sem tela própria): o
Filão tem tela própria, e é a pessoa quem decide o que entra. Um Bruto pode estar em vários
Filões ao mesmo tempo.
_Evite_: pasta, coleção, categoria pessoal

**Pasta de exportação**:
Diretório escolhido pela pessoa, no próprio Chrome (via permissão de arquivo do navegador),
para onde o app copia automaticamente o pacote completo de artefatos de cada Bruto processado,
organizado como `<pasta>/<Categoria>/<título>/`. É sempre cópia — nunca substitui a biblioteca
canônica em `~/.bruto/library/`, que é onde o pipeline realmente grava.
_Evite_: destino, diretório de saída, backup
