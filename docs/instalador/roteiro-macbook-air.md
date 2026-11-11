# Roteiro do MacBook Air — testar o instalador `.dmg` do Bruto

O objetivo é provar o instalador numa máquina que nunca viu o Bruto, do jeito que uma
pessoa de verdade vai viver: baixar (receber) o `.dmg`, instalar, passar pelo aviso da
Apple e usar. Duas máquinas entram na história:

- **MAC MINI** — onde o `.dmg` é construído (`npm run instalador:macos`). Não é a máquina
  do teste; é só a origem do arquivo.
- **MACBOOK AIR** — a "máquina da pessoa". É nela que tudo abaixo roda.

O roteiro é o script `scripts/instalador-macos/roteiro-macbook-air.sh`, com quatro
subcomandos: `listar` (somente leitura), `limpar --listagem <arquivo>` (reversível),
`testar` (depois de instalar) e `restaurar` (desfaz o `limpar` depois do teste).
Ajuda completa: `bash roteiro-macbook-air.sh --ajuda`.

## Por que o `.dmg` vai de AirDrop

O AirDrop marca o arquivo recebido com o atributo de quarentena, como um download real.
É exatamente o que uma pessoa que baixa o `.dmg` do site vai ter — então o aviso da
Apple ("não pode ser verificado") e o caminho de liberação ("Abrir Mesmo Assim") são
exerciciados de verdade. Copiar o arquivo por pendrive ou `rsync` não marca a quarentena
e pularia justamente a parte mais assustadora para quem nunca usou terminal.

## A ordem (passos numerados)

### 1. No MAC MINI: mandar o roteiro para o Air

AirDrop do arquivo `scripts/instalador-macos/roteiro-macbook-air.sh` (do repositório)
para o MacBook Air. Ele chega em **Downloads**. O script é pequeno e não precisa de
quarentena — roda com `bash`.

### 2. No MACBOOK AIR: listar o que já existe

1. Abra o **Terminal** (**Command + Espaço**, digite `Terminal`, Enter).
2. Rode:

   ```bash
   bash ~/Downloads/roteiro-macbook-air.sh listar
   ```

3. O script imprime tudo do Bruto que existir na máquina — clone (`~/Bruto`), os dois
   `Bruto.app` (`~/Applications` e `/Applications`), os dados (`~/.bruto`, só as
   subpastas de 1º nível e o tamanho, nunca o conteúdo), os manifestos do host nativo
   (`com.ideiabusiness.bruto.json` de Chrome/Chromium/Edge/Brave), o que escuta na
   porta 3000 (PID, comando e o **veredito com prova**: provado do Bruto — caminho/cwd
   e `/api/versao` — ou não, com o motivo) e se há `yt-dlp`/`ffmpeg`/`node`/`uv` no
   PATH (só informativo — **não** são do Bruto e **não** serão removidos).
4. A listagem fica gravada em `~/Desktop/bruto-listagem-<data>.txt`.

É somente leitura: nada é removido, nada é encerrado.

### 3. No MACBOOK AIR: mandar a listagem para a orquestradora

Mande o arquivo `~/Desktop/bruto-listagem-<data>.txt` de volta (AirDrop, e-mail — o que
for). A orquestradora confere que só tem item do Bruto e autoriza o `limpar`. Se a
máquina está realmente "virgem", a listagem vai quase vazia — e o `limpar` a seguir não
tem o que fazer, o que também é resultado.

### 4. No MACBOOK AIR: limpar (reversível)

```bash
bash ~/Downloads/roteiro-macbook-air.sh limpar --listagem ~/Desktop/bruto-listagem-<data>.txt
```

O que o `limpar` faz:

- remove **exatamente** os itens do arquivo de listagem que sejam do Bruto — mas só
  o que é **regenerável sem perda**: os dois `Bruto.app` e os manifestos do host
  nativo (o instalador e o registrador os recriam);
- **nunca apaga `~/Bruto` nem `~/.bruto`**: o clone pode ter o `.env` da pessoa
  (chaves de API) e mudanças locais que não existem em lugar nenhum, e `~/.bruto` é
  a biblioteca de vídeos — os dois são **movidos** para `<nome>-antes-do-teste-<data>`
  (`~/Bruto-antes-do-teste-<data>` e `~/.bruto-antes-do-teste-<data>`); para desfazer,
  use o subcomando `restaurar` (o `limpar` imprime o comando no fim da rodada); se um
  backup datado de hoje já existir, a rodada é recusada antes de mexer em qualquer
  coisa;
- encerra o servidor da porta 3000 **só** se a identidade for **provada**: o
  executável (comando completo) ou o cwd (`lsof`) dentro de um caminho do Bruto
  (`/Applications/Bruto.app`, `~/Applications/Bruto.app` ou `~/Bruto`) **e**, se a
  porta responder `/api/versao`, `app=bruto` — o nome no comando (`server.js`,
  `next-server`, `serve.sh`) **não** prova nada; qualquer dúvida significa "não é
  do Bruto", o processo não é encerrado e o motivo aparece na saída;
- pede a confirmação digitada **LIMPAR** antes de qualquer remoção — errar a palavra
  (ou só dar Enter) não remove nada;
- se algo na listagem **não** é do Bruto (alguém editou o arquivo e pôs, por exemplo,
  `~/Documents`), a rodada inteira é **recusada**: nada é removido.

O que o `limpar` **nunca** faz: `sudo`; tocar no Homebrew, no `uv` global, no Node, ou em
qualquer coisa que esteja no PATH e não seja do Bruto.

### 5. No MAC MINI: AirDrop do `.dmg`

AirDrop do `dist/Bruto-<versão>-arm64.dmg` para o MacBook Air. Ele chega em **Downloads**
com a quarentena — que é o que a gente quer (ver "Por que o `.dmg` vai de AirDrop").

### 6. No MACBOOK AIR: instalar como uma pessoa instala

1. Duplo-clique no `.dmg` (em **Downloads**).
2. Arraste o **Bruto** para a pasta **Applications**.
3. Duplo-clique no **Bruto** (em **Aplicativos**). O macOS **bloqueia** — é esperado,
   o app não tem assinatura Apple na v1.
4. **Ajustes do Sistema → Privacidade e Segurança → seção Segurança → "Abrir Mesmo
   Assim" → confirmar "Abrir"** (pode pedir a senha). Em macOS recentes o
   clique-direito → Abrir **não** basta.

### 7. No MACBOOK AIR: testar

```bash
bash ~/Downloads/roteiro-macbook-air.sh testar
```

O `testar` confere a quarentena e diz o que a pessoa vai ver, verifica a assinatura
(`codesign`), abre o app (`open -a /Applications/Bruto.app`) e espera `/api/versao`
por até 90 s. A aprovação é **só com prova**: a resposta tem de ser JSON válido
(parser real, `plutil`) com `app=bruto`, `origem=pacote` e **versão igual à do
`Info.plist` do app instalado** (lida com `/usr/libexec/PlistBuddy`). Qualquer outra
coisa — `origem=clone`, corpo não-JSON, versão diferente — **reprova** o teste: o
script termina com código ≠ 0 e o motivo fica no resumo. No fim, diz o próximo passo
(colar um vídeo curto do YouTube e processar até o export) e onde está o log
(`~/.bruto/logs/servidor.log`). O resumo fica em `~/Desktop/bruto-teste-<data>.txt`.

### 8. No MACBOOK AIR: usar de verdade e mandar o resumo

Cole um vídeo curto do YouTube (uns 20 s) e deixe correr: metadados → legenda → resumo →
mapa → categoria → export. O primeiro vídeo baixa o baixador de vídeos (alguns minutos);
o primeiro export baixa o Chromium. Depois, mande
`~/Desktop/bruto-teste-<data>.txt` de volta para a orquestradora.

## Rollback (desfazer o teste)

```bash
bash ~/Downloads/roteiro-macbook-air.sh restaurar
```

Não use `mv` na mão: depois do `testar`, o app pode ter **recriado** `~/.bruto` (e
`~/Bruto`), e um `mv` do backup para o lugar poria o backup **dentro** da pasta nova,
deixando a antiga fora do caminho. O `restaurar`:

1. fecha o servidor do Bruto da porta 3000 — **só** o de identidade provada
   (executável/cwd num caminho do Bruto e, respondendo `/api/versao`, `app=bruto`),
   com confirmação; **recusar fechar aborta sem mover nada** (restaurar por cima de
   um servidor no ar é o cenário perigoso);
2. **preserva** o que o teste recriou: a `~/.bruto` da rodada de teste vai para
   `~/.bruto-do-teste-<data>` e o `~/Bruto` da rodada vai para
   `~/Bruto-do-teste-<data>` — nada é apagado;
3. devolve os backups: `~/.bruto-antes-do-teste-<data>` volta a ser `~/.bruto`
   (biblioteca inteira, com os vídeos da pessoa) e `~/Bruto-antes-do-teste-<data>`
   volta a ser `~/Bruto` (`.env` e mudanças locais intactos);
4. recusa a rodada inteira (antes de mexer em qualquer coisa) se alguma pasta
   `-do-teste-<data>` de hoje já existir.

Os itens removidos pelo `limpar` (apps e manifestos — regeneráveis) podem ser
recriados com o instalador de terminal (`curl | bash`), se a máquina precisar voltar
ao estado anterior.

## Sinal amarelo durante o teste

Se algum comando falhar com **"Operation not permitted"**, não contorne: anote o comando
e o contexto no resumo (`bruto-teste-<data>.txt`) e mande para a orquestradora.
