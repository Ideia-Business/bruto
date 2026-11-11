# Roteiro do MacBook Air — testar o instalador `.dmg` do Bruto

O objetivo é provar o instalador numa máquina que nunca viu o Bruto, do jeito que uma
pessoa de verdade vai viver: receber o `.dmg`, instalar, passar pelo aviso da Apple e
usar. Duas máquinas entram na história:

- **MAC MINI** — onde o `.dmg` é construído (`npm run instalador:macos`). Não é a máquina
  do teste; é só a origem do arquivo.
- **MACBOOK AIR** — a "máquina da pessoa". É nela que tudo abaixo roda.

> **O roteiro é SOMENTE LEITURA (decisão de 11/11/2026).** O script
> `scripts/instalador-macos/roteiro-macbook-air.sh` nunca move, apaga, renomeia ou cria
> nada (a única escrita é o relatório na Mesa) e nunca envia sinal a processo nenhum.
> Ele tem só dois subcomandos: `listar` (inventário do que existe) e `testar` (coleta o
> material da prova e **não julga nada** — quem confere é a orquestradora). **Limpar a
> máquina e desfazer o teste são passos seus, à mão, escritos neste documento** (passos
> 2 e 5): um comando por linha, conferindo o resultado de cada um com `ls -ld`. Os
> antigos subcomandos `limpar` e `restaurar` não existem mais no script.

Para levar o roteiro ao Air: AirDrop do arquivo `scripts/instalador-macos/roteiro-macbook-air.sh`
(saindo do MAC MINI, do repositório) — ele chega em **Downloads** e roda com `bash`,
sem instalar nada.

## 1. No MACBOOK AIR — fechar o Bruto, listar e mandar o arquivo

1. Feche o Bruto e o que possa estar rodando dele:
   - **Bruto aberto?** Clique nele e saia com **Cmd+Q** (fechar só a janela não fecha
     o app).
   - **Rodou o `serve.sh` do clone noutra janela do Terminal?** Feche **aquela** janela
     (**Cmd+W**) ou pare o comando com **Ctrl+C** nela.
   - **Não souber o que está aberto?** **Reinicie o Mac** — é a forma mais simples de
     garantir.
2. Abra o **Terminal** (**Command + Espaço**, digite `Terminal`, Enter) e rode — o
   `uname -m` tem de dar `arm64` (o `.dmg` do Bruto é Apple Silicon; der outra
   coisa, mande para a orquestradora antes de seguir):

   ```bash
   uname -m
   bash ~/Downloads/roteiro-macbook-air.sh listar
   ```

3. O script imprime, sem mexer em nada: o clone (`~/Bruto`), os dois `Bruto.app`
   (`~/Applications` e `/Applications`), os dados (`~/.bruto` com tamanho e subpastas de
   1º nível — nunca o conteúdo), os manifestos do host nativo
   (`com.ideiabusiness.bruto.json` de Chrome/Chromium/Edge/Brave), o que escuta na
   porta 3000 (**PID e comando, sem julgar se é do Bruto**) e se há
   `yt-dlp`/`ffmpeg`/`node`/`uv` no PATH (só informativo — **não** são do Bruto e
   **não** serão tocados).
4. Mande o arquivo `~/Desktop/bruto-listagem-<data>.txt` para a orquestradora
   (AirDrop, e-mail — o que for) e **espere a conferência dela** antes do passo 2.
   Se a máquina está realmente "virgem", a listagem vem quase vazia — e o passo 2
   não tem o que mover, o que também é resultado.

## 2. No MACBOOK AIR — mover à mão (SÓ depois de a orquestradora conferir a listagem)

Não faça nada aqui antes de a orquestradora conferir a listagem. Cada comando vai em
uma linha; depois de cada um, confira o resultado com `ls -ld` no caminho de destino.
Cada `mv` vem embrulhado numa guarda: se o destino já existe, o comando imprime uma
linha `PARE` e não move nada — um `mv` simples, com destino pasta que já existe, não
daria erro nenhum: moveria a origem PARA DENTRO do destino, em silêncio.

```bash
[ -e ~/Bruto-antes-do-teste ] && echo "PARE: ~/Bruto-antes-do-teste já existe" || mv ~/Bruto ~/Bruto-antes-do-teste
```

```bash
[ -e ~/.bruto-antes-do-teste ] && echo "PARE: ~/.bruto-antes-do-teste já existe" || mv ~/.bruto ~/.bruto-antes-do-teste
```

- Para o app da instalação antiga: arraste `~/Applications/Bruto.app` para o **Lixo**
  (pelo Finder).

> Se aparecer uma linha começando com **PARE**, não tente de novo com outro nome:
> mande a mensagem para a orquestradora. A linha só aparece quando o destino já
> existe — significa que já há um backup antigo no lugar, e sobrescrever backup é
> justamente o que nunca se faz.
>
> Se o erro for "No such file or directory" na ORIGEM (`~/.bruto`, por exemplo, quando
> ela não existe nesta máquina), pode seguir para o comando seguinte.

`~/Bruto` pode ter o seu `.env` e mudanças locais; `~/.bruto` é a sua biblioteca de
vídeos. Os dois são **movidos, nunca apagados** — é por isso que este passo existe e é
à mão.

## 3. No MAC MINI — AirDrop do `.dmg`

AirDrop do `dist/Bruto-<versão>-arm64.dmg` para o MacBook Air. **Por que AirDrop:** o
AirDrop marca o arquivo recebido com o atributo de quarentena, como um download real.
É exatamente o que uma pessoa que baixa o `.dmg` do site vai ter — então o aviso da
Apple ("não pode ser verificado") e o caminho de liberação ("Abrir Mesmo Assim") são
exerciciados de verdade. Copiar o arquivo por pendrive ou `rsync` não marca a
quarentena e pularia justamente a parte mais assustadora para quem nunca usou terminal.

## 4. No MACBOOK AIR — instalar como uma pessoa e testar

1. Duplo-clique no `.dmg` (em **Downloads**).
2. Arraste o **Bruto** para a pasta **Applications**.
3. Duplo-clique no **Bruto** (em **Aplicativos**). O macOS **bloqueia** — é esperado,
   o app não tem assinatura Apple na v1.
4. **Ajustes do Sistema → Privacidade e Segurança → seção Segurança → "Abrir Mesmo
   Assim" → confirmar "Abrir"** (pode pedir a senha). Em macOS recentes o
   clique-direito → Abrir **não** basta (igual ao INSTALAR.md).
5. Cole um vídeo curto do YouTube (ex.: `https://www.youtube.com/watch?v=jNQXAC9IVRw`)
   e deixe correr: metadados → legenda → resumo → mapa → categoria → export. O
   primeiro vídeo baixa o baixador de vídeos (alguns minutos); o primeiro export baixa
   o navegador que gera os arquivos.
6. Agora rode o teste:

   ```bash
   bash ~/Downloads/roteiro-macbook-air.sh testar
   ```

   O `testar` confere o atributo de quarentena e diz o que a pessoa vai ver, verifica a
   assinatura (`codesign`), abre o app (`open -a /Applications/Bruto.app` — a única
   ação dele além de ler) e **coleta**: o **corpo bruto** da resposta de `/api/versao`
   (exatamente o que veio, sem análise nenhuma), a versão do `Info.plist` do app
   instalado (`PlistBuddy`) e as últimas 20 linhas de `~/.bruto/logs/servidor.log`.
   **Ele não decide resultado** — não existe "aprovado" nem "reprovado" no roteiro; ele
   termina mandando o arquivo para a orquestradora conferir. Sai com exit 0 quando
   consegue coletar; sai com exit ≠ 0 só quando não consegue coletar nem o corpo (o
   motivo fica no próprio resumo).
7. Mande `~/Desktop/bruto-teste-<data>.txt` para a orquestradora.

## 5. No MACBOOK AIR — desfazer o teste (à mão, com o Bruto fechado)

Primeiro feche o Bruto como no passo 1 (Cmd+Q; feche a janela do Terminal se o
`serve.sh` estiver rodando; na dúvida, reinicie o Mac). Depois, um comando por linha,
conferindo o resultado de cada um com `ls -ld`:

1. Arraste `/Applications/Bruto.app` para o **Lixo** (pelo Finder).
2. Preserve o que o teste recriou:

   ```bash
   [ -e ~/.bruto-do-teste ] && echo "PARE: ~/.bruto-do-teste já existe" || mv ~/.bruto ~/.bruto-do-teste
   ```

3. Devolva a biblioteca antiga:

   ```bash
   [ -e ~/.bruto ] && echo "PARE: ~/.bruto já existe" || mv ~/.bruto-antes-do-teste ~/.bruto
   ```

4. Devolva o clone antigo:

   ```bash
   [ -e ~/Bruto ] && echo "PARE: ~/Bruto já existe" || mv ~/Bruto-antes-do-teste ~/Bruto
   ```

> **O mesmo aviso do passo 2:** se aparecer uma linha começando com **PARE**, não
> tente de novo com outro nome — mande a mensagem para a orquestradora.
>
> Se o erro for "No such file or directory" na ORIGEM (`~/.bruto` no item 2, por
> exemplo, quando o teste não recriou a pasta), pode seguir para o comando seguinte.

Nada é apagado: o que o teste recriou fica preservado em `~/.bruto-do-teste` para
conferência. Se a máquina precisar voltar ao estado anterior por completo, os itens
regeneráveis (app de `~/Applications` e manifestos do host, se existiam) são recriados
pelo instalador de terminal (`curl | bash`).

## No MACBOOK AIR — sinal amarelo durante o teste

Se algum comando falhar com **"Operation not permitted"**, não contorne: anote o
comando e o contexto no arquivo da Mesa (`bruto-teste-<data>.txt` ou
`bruto-listagem-<data>.txt`) e mande para a orquestradora.
