# Onda 2 — a extensão liga o app local (escopo congelado)

Origem: grelha de 06/11/2026 (Q1–Q10, todas confirmadas pelo dono). Decisões: ADR `0003` (host nativo,
permissão opcional) e ADR `0004` (o ID de produção vem do item da loja). Glossário: `CONTEXT.md`
(**App local**, **Host nativo**). Estado de partida: o host e o registrador estão na `main` (`0da548e`);
a extensão ainda não usa `connectNative` nem `nativeMessaging`.

**Postura de escopo: segurar.** Nada além do que está abaixo entra sem uma decisão nova do dono.

## Onda 2a — registrador com vários IDs (sai primeiro, não depende de Chrome real)
- `launcher/registrar-host.sh`: `--extensao-id` repetível; `BRUTO_EXTENSAO_ID` aceita lista (vírgula ou
  espaço); `allowed_origins` com uma origem por ID; cada ID validado (32 letras a–p); a `key` do manifest,
  se existir, entra como mais um ID. Sem nenhum ID: continua não escrevendo nada e saindo 0. `--remover`,
  idempotência e a lista de navegadores não mudam.
- `install/CONTRATO.md`: documentar a lista de IDs.
- Testes em `tests/install/registrar-host.test.ts` (vários IDs, ID inválido no meio da lista, idempotência,
  `--remover`).
- **Pronto quando:** `npm test`, `tsc`, `eslint`, `shellcheck` verdes; Codex com 0 achados no delta; selo gravado.

## Onda 2b — a extensão (só é publicada depois do roteiro manual do dono)
- `extension/src/lib/host-nativo.ts` (ponte): pede a permissão como PRIMEIRA chamada do clique
  (`chrome.permissions.request`, sem `await` antes), abre `chrome.runtime.connectNative("com.ideiabusiness.bruto")`
  e manda só `{"cmd":"ligar"}` (ou `{"cmd":"status"}`). Resultados: `pronto` · `permissao-negada` · `host-ausente` ·
  `falha-ao-ligar` · `demora` (>60 s) · `erro`. O popup fecha ao perder o foco: a UI espera até ~60 s, depois
  orienta a reabrir em 1 min; a reabertura faz `status`. Nenhum estado novo persistente.
- `extension/manifest.json`: `optional_permissions: ["nativeMessaging"]`. **Sem** mudar `version`
  (a publicação e o bump são do dono).
- Popup: botão **"Ligar o app"** nos dois pontos de falha existentes (`semApp` na tela Instagram/TikTok;
  `saude === null` no Modo completo). Depois de ligado: estado "Pronto" e o fluxo original volta a ficar clicável
  (a extensão nunca envia link que a pessoa não clicou). "Abrir Bruto" vira **"Abrir o app"**.
- Textos (aprovados): Ligando · "Ligando o app… na primeira vez pode levar alguns minutos." — Pronto · "Pronto: o app
  está ligado." — Demora · "Ainda iniciando. Reabra a extensão em 1 minuto." — Permissão negada · "Sem essa permissão a
  extensão não consegue ligar o app. Abra o app pelo ícone e clique de novo." — Host não registrado · "A extensão ainda
  não está ligada ao app neste computador. Rode o instalador do Bruto de novo e tente outra vez." — `falha-ao-ligar` ·
  "O app não subiu. Detalhes no arquivo bruto-server.log, na pasta temporária do sistema." — Erro · "Algo travou ao ligar o app."
- Documentos: `extension/LOJA.md` (justificativa da permissão `nativeMessaging`), `extension/PRIVACIDADE.md` (uma frase: a
  permissão só liga o app local), `extension/TESTANDO.md` (o roteiro manual abaixo).
- Testes: `tests/extension/host-nativo.test.ts` com dublê de `chrome.runtime.connectNative` e `chrome.permissions`
  (concedida, negada, host ausente, `falha-ao-ligar`, demora, resposta fora do contrato).
- **Pronto quando:** testes, `tsc`, `eslint` verdes; Codex com 0 achados; selo gravado. **"Apta para uso" só depois do
  roteiro manual do dono.** Antes disso a entrega é declarada: *implementada, NÃO EXERCIDA no Chrome real* (nem a tela do
  popup, nem a permissão, nem a sobrevivência do servidor).

## Roteiro manual (do dono, ~5 min, Chrome real)
1. Carregar `extension/pacote/bruto-<versão>` descompactada em `chrome://extensions`; copiar o ID mostrado.
2. `bash launcher/registrar-host.sh --extensao-id <ID>`.
3. Com o app FECHADO, abrir um vídeo de Instagram/TikTok, clicar em "Ligar o app" e aceitar o pedido de permissão.
4. Conferir "Pronto" e que `http://127.0.0.1:3000` responde; **fechar o Chrome inteiro** e conferir que o servidor segue de pé.
5. Repetir negando a permissão e conferir a mensagem de "Permissão negada".

## Fora desta onda (decisão, não esquecimento)
Firefox · Windows (depende do teste 0.2 do dono) · criar o item na loja e a `key` (do dono) · bump de versão e publicação
· ligar o app no boot do computador · qualquer comando além de `status` e `ligar` no host · prova de Edge/Brave/Chromium
(herdam o registro, sem prova nossa, declarado).

## Execução (regra do dono, 06/11/2026)
- **Trabalho braçal só com Kimi (`kimi-auto/kimi-k3`, assinatura Kimi Code) ou GLM (`zai-coding-plan/glm-5.3`)**, pelo
  `~/.ideiaos/bin/opencode-ideiaos`, cada um num worktree próprio e com território disjunto (2a: registrador+testes; 2b:
  ponte+testes e popup+manifest+docs, divididos por arquivo). A Kimi Platform (paga por uso) continua desligada.
- **Revisão com o Codex** (`cross-vendor-review.sh --base origin/main`), obrigatória: repositório público e executa programa
  na máquina da pessoa. O orquestrador não escreve o código braçal: briefa, confere cada prova que o worker afirma, integra e
  mantém o handoff.
- Sem push nem integração sem ordem do dono.
