# Estudo Técnico e Plano de Adoção: Ideia Vault (`ivault`) no Bruto

**Data:** 17 de Outubro de 2026  
**Autor:** Time de Arquitetura IdeiaOS / Deia  
**Demanda DevTasks:** `002c7a78-d829-414a-9d7f-ce160a26c72e` (adequada de Infisical para Ideia Vault)  
**Referências:** `docs/guides/ideia-vault.md`, `credential-isolation.md`, `secure-by-default.md`.

---

## 1. Contexto e Justificativa da Mudança

A demanda original mencionava o Infisical self-hosted. Em outubro de 2026, a infraestrutura da Ideia Business descontinuou o Infisical (instância desligada em 14/10/2026) e consolidou o **Ideia Vault** (`https://vault.ideiabusiness.com.br`) com a CLI `ivault`.

A CLI `ivault` já está instalada em `/Users/gustavolopespaiva/.ivault/bin/ivault` e autenticada como `gustavo@redeideia.com.br` na organização `ideiabusiness`.

---

## 2. Inventário de Variáveis do Bruto

Uma auditoria estrita em `src/` e `servidor/` revelou a exata fronteira entre **segredos** e **configurações públicas**:

### 2.1 Segredos Reais (Cofre `ivault` — Ambiente `dev`)
Essas variáveis contêm credenciais ou tokens de acesso e **devem** residir exclusivamente no Ideia Vault:

| Chave | Finalidade | Escopo |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | Endpoint do Redis Upstash para contadores de rate-limit | Servidor / Modo grátis |
| `UPSTASH_REDIS_REST_TOKEN` | Token secreto do Redis Upstash | Servidor / Modo grátis |
| `OLLAMA_API_KEY` | Chave de acesso à API Ollama Cloud | Servidor / Modo grátis |
| `ANTHROPIC_API_KEY` | Chave de API da Anthropic (fallback modo chave) | App local (opcional) |
| `OPENAI_API_KEY` | Chave de API da OpenAI (fallback modo chave) | App local (opcional) |
| `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Chave de API do Opus 5.5 Opus 5.5 (fallback modo chave) | App local (opcional) |
| `OPENROUTER_API_KEY` | Chave de API do OpenRouter (fallback modo chave) | App local (opcional) |
| `BRUTO_SAL` | Salt criptográfico de hash de IPs no servidor | Servidor (opcional) |

*Nota importante:* Quem usa o Bruto pelo plano Opus 5.5 CLI ou Codex CLI não precisa de nenhuma chave de IA, pois a autenticação é verificada localmente pela sessão ativa da máquina.

### 2.2 Configurações Públicas (Devem permanecer fora do cofre)
Ficam documentadas no `.env.example` e possuem valores padrão seguros no código:
- `BRUTO_DATA_ROOT` (Default: `~/.bruto`)
- `BRUTO_LLM_PROVIDER` (Default: detecção automática)
- `BRUTO_MODEL_FAST`, `BRUTO_MODEL_BALANCED`, `BRUTO_MODEL_DEEP`
- `BRUTO_WHISPER_MODEL` (Default: `base`)
- `PORT` (Default: `3000`)
- `HOST` (Default: `127.0.0.1`)

---

## 3. Plano de Implantação e Adoção

### Onda 1: Criação do Projeto no Ideia Vault (Ação Humana no Painel)
1. Acessar `https://vault.ideiabusiness.com.br`.
2. Na organização `ideiabusiness`, criar o projeto com slug `bruto`.
3. Popular as credenciais de desenvolvimento no ambiente `dev` (Upstash, chaves de IA se utilizadas).

### Onda 2: Vinculação Local (`ivault init`)
Na raiz do repositório `/Users/gustavolopespaiva/Bruto`:
```bash
ivault init --project bruto --env dev
```
Isso gera o arquivo `.ivault.json`:
```json
{
  "$schema": "https://vault.ideiabusiness.com.br/schema/project.json",
  "project": "bruto",
  "defaultEnvironment": "dev"
}
```
O arquivo `.ivault.json` é público e **deve ser rastreado pelo Git**.

### Onda 3: Script de Execução via Cofre no `package.json`
Adicionar atalho de inicialização segura no `package.json`:
```json
"scripts": {
  "dev:vault": "ivault run -- next dev -H 127.0.0.1",
  "app:vault": "ivault run -- node launcher/serve.mjs"
}
```
Com isso, as variáveis entram direto na memória do processo via `process.env`, sem criar nenhum arquivo `.env` em disco.

### Onda 4: Higiene e Gate Binário
- Manter `.env` e `.env.local` estritamente no `.gitignore`.
- O hook `credential-read-guard` continuará protegendo o repositório contra leituras acidentais de segredos.

---

## 4. Reconciliação no DevTasks
Para atualizar o ticket `002c7a78-d829-414a-9d7f-ce160a26c72e` no DevTasks com a nomenclatura e estratégia vigentes:
- Atualizar descrição e título para: *"Migrar segredos de dev do Bruto para o Ideia Vault (ivault)"*.
- Vincular este relatório como base da execução.
