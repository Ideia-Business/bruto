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

**App local**:
O programa do Bruto rodando na máquina da pessoa (o servidor em `127.0.0.1`, com ou sem janela).
É ele que destrincha Instagram, TikTok e vídeo sem legenda. Não se confunde com **Bruto**, que é só
o material de entrada: "ligar o app", nunca "ligar o Bruto".
_Evite_: o Bruto (para o programa), servidor, aplicativo

**Cancelado**:
Estado terminal do job quando a pessoa interrompe o processamento (ou o job descobre uma
duplicata ativa). O que já foi salvo até ali, salvo fica; o vídeo NÃO conta como concluído
("Tentar de novo" segue valendo) e o boot não ressuscita job cancelado.
_Evite_: abortado, parado, falhado (falhou é **Erro**)

**Duplicata ativa**:
O mesmo vídeo (mesma IDENTIDADE — `watch?v=`, `youtu.be` e `/shorts/` do mesmo ID — não a
mesma string de URL) já com job `queued` ou `running`: as portas de entrada respondem 409
"Esse vídeo já está na fila" apontando o job ativo; link curto que só revela o ID depois da
etapa metadata se encerra como **Cancelado**.
_Evite_: duplicado, reprocessamento (que é o retry, intencional)

**Host nativo**:
O pequeno programa que o Chrome chama, pela permissão opcional `nativeMessaging`, para ligar o
App local quando a pessoa clica em "Ligar o app" na extensão. Aceita só dois comandos, `status` e
`ligar`, e nunca recebe caminho, argumento ou comando da mensagem. Sai logo depois de responder; o
App local que ele liga continua de pé sozinho. Fica registrado por navegador pelo instalador.
_Evite_: daemon, serviço, agente, helper

**Pacote**:
O `Bruto.app` autocontido que vem dentro do `.dmg`: carrega o próprio Node e o ffmpeg, e se
instala arrastando para Aplicativos — sem terminal e sem Homebrew. Só para macOS com chip
Apple (arm64).
_Evite_: instalador executável, app baixado

**Modo pacote** × **Modo clone**:
De onde o App local sobe. Modo pacote: o servidor do `Bruto.app`, que se anuncia em
`/api/versao` com `origem=pacote` e resolve as ferramentas por caminho absoluto dentro do
pacote. Modo clone: instalação por `curl | bash` a partir de `~/Bruto`, `origem=clone`. A
biblioteca (`~/.bruto`) é a mesma nos dois.
_Evite_: instalado × desenvolvedor (a diferença é de onde o servidor sobe, não quem usa)

**Ferramentas**:
`~/.bruto/ferramentas`: onde vivem o yt-dlp, o Whisper e o Chromium que o próprio app instala
sob demanda. Nunca vêm do sistema nem de gerenciador de pacotes da pessoa.
_Evite_: dependências, cache

**Primeiro uso**:
A primeira vez que cada função roda, o app baixa o que ela precisa — o baixador de vídeos no
primeiro vídeo, o Chromium no primeiro export; alguns minutos a mais, só dessa vez. O
Whisper (~3 GB entre ferramenta e modelo, já com o large-v3-turbo) só desce quando a pessoa
pede em Configurações.
_Evite_: instalação (as ferramentas vêm depois dela, sozinhas)
