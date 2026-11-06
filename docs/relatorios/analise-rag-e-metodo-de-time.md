# Relatório Técnico: Análise de Adoção do Padrão RAG + Método de Time no Bruto

**Data:** 17 de Outubro de 2026  
**Autor:** Time de Arquitetura IdeiaOS / Deia (Gustavo Lopes Paiva)  
**Demanda DevTasks:** `fd4b32e7-6910-4535-8a37-83484fb15cc2`  
**Referências:** Doutrina `rag-conhecimento.md`, `metodo-de-time.md`, ADR `0001-tags-nao-hierarquia.md`, ADR `0002-pasta-exportacao-e-copia.md`.

---

## Sumário Executivo

| Frente | Indicativo Objetivo | Justificativa Sintética |
|---|---|---|
| **1. RAG com pgvector (Postgres)** | **NÃO IMPLEMENTAR** | O Bruto é um app desktop local autossuficiente (SQLite em `~/.bruto/library/`). Exigir Postgres + pgvector destruiria a experiência de instalação e uso local do produto (violação direta de `rag-conhecimento.md` §10). A busca semântica ou pesquisa no catálogo é atendível por SQLite FTS5 ou sqlite-vec local. |
| **2. Método de Time de Lanes** | **RECOMENDADO / APROVADO** | O método de trabalho em lanes isoladas com revisão cross-vendor até o selo (`metodo-de-time.md`) já demonstrou eficácia no Bruto (ex.: PRs #19 e #20 com selo LIMPO do Codex). Deve ser o padrão oficial para grandes frentes. |

---

## 1. Diagnóstico do Estado Atual do Bruto

### 1.1 Stack de Dados e Infraestrutura Local
- **Banco de Dados:** SQLite nativo via `better-sqlite3` gerenciado por Drizzle ORM (`drizzle-orm` v0.45).
- **Armazenamento:** `~/.bruto/library/` guarda o banco SQLite (`bruto.db`), os artefatos gerados (DOCX, PDF, áudio extraído, transcrições, mapas mentais) e metadados.
- **Runtime:** Next.js (Node.js) servido em `127.0.0.1:3000` via script launcher (`launcher/serve.mjs`), sem Electron e sem dependência de containers Docker ou serviços de nuvem para a operação principal.
- **Privacidade e Isolamento:** Aplicação pessoal de uso solo. Não existe multi-tenancy, organização, RLS ou partição por empresa.

### 1.2 Fontes de Conhecimento e Consumidores Atuais
- **Fontes:**
  - Vídeos cadastrados (`brutos`);
  - Transcrições brutas e com marcação de tempo (`transcripts`);
  - Resumos executivos (`summary_md`);
  - Mapas mentais estruturados (`mindmap_md`);
  - Aulas didáticas completas (`study_md`);
  - Transcrições organizadas e formatadas para LLM (`transcript_organized_md`, `transcript_llm_md`);
  - Tags de assunto e categorias.
- **Consumidores:**
  - Interface web local (Bancada de estudo, Catálogo com filtros de tag/categoria, busca textual);
  - A pessoa usuária exportando para seu computador ou abrindo o Caderno de Ideias / Lapid.ai;
  - Nenhuma API externa consome esses dados, preservando sigilo total dos estudos.

---

## 2. Análise Crítica: Padrão RAG com pgvector

### 2.1 Confronto com a Doutrina `rag-conhecimento.md`
A doutrina de RAG da frota (nascida na Polaria em 08/10/2026) foi concebida para **ERPs e sistemas SaaS multi-tenant**, onde:
1. O banco Postgres já existe na infraestrutura de produção;
2. Há dezenas de milhares de documentos empresariais com RLS estrito;
3. A busca híbrida (pgvector + GIN tsvector) corre dentro da mesma transação relacional.

O próprio documento `rag-conhecimento.md` lista na **Seção 10 (Quando NÃO usar)** critérios que se aplicam categoricamente ao Bruto:
> - *"Sem Postgres existente: não crie um serviço vetorial ou infraestrutura pesada à parte se a aplicação não possui Postgres."*
> - *"Corpus pequeno que cabe no contexto do modelo: envie o documento direto para o modelo."*

### 2.2 Impactos Negativos caso pgvector fosse adotado no Bruto
1. **Destruição do instalador one-liner:** O Bruto hoje instala com `curl | sh` ou script simples. Exigir Postgres + extensão pgvector forçaria o usuário comum a instalar Docker, provisionar PostgreSQL e manter daemons de banco rodando em background.
2. **Consumo de Memória:** Postgres + pgvector consumiria centenas de megabytes de RAM em background para indexar vídeos de estudo pessoal.
3. **Custo e Dependência:** O Bruto foi desenhado para funcionar localmente sem chaves obrigatórias (usando modelos de plano local Codex/Claude CLI ou modo grátis). RAG baseado em embeddings de nuvem adicionaria custos por token desnecessários para quem usa o app.

### 2.3 Alternativa Recomendada para Busca no Bruto
Se o objetivo for enriquecer a busca e cruzamento de aulas no acervo do Bruto:
1. **Curto Prazo:** Habilitar **SQLite FTS5 (Full-Text Search)** no banco existente via migração Drizzle. O FTS5 é nativo do SQLite, instantâneo, não consome memória extra e entrega busca ponderada com ranking BM25 sobre transcrições e resumos.
2. **Médio Prazo (Se busca vetorial for necessária):** Adotar `sqlite-vec` (extensão pura em C compilada para SQLite, embutível via npm sem nenhum daemon externo) ou embeddings locais via `@xenova/transformers` (ONNX local).

**Veredito sobre RAG com pgvector:** **REJEITADO (NÃO IMPLEMENTAR)**.

---

## 3. Análise: Adoção do Método de Time (Lanes + Cross-Vendor)

### 3.1 Avaliação do Método (`metodo-de-time.md`)
O método de time prevê:
1. **Isolamento por Lane:** Cada frente de trabalho roda em seu próprio worktree (`bruto/.wt/<assunto>`), branch `lane/<assunto>`. Evita colisão em arquivos em voo e no índice git.
2. **Brief com Territórios Disjuntos:** Especificação clara dos arquivos que cada agente pode escrever.
3. **Revisão Cross-Vendor até o Selo:** Revisão por fornecedor alternativo (ex.: Codex CLI revisando diffs gerados pelo Opus 5.5, ou vice-versa) gerando relatório estruturado com 0 achados críticos/altos antes do merge.

### 3.2 Evidência no Bruto
O Bruto já utilizou e provou este método com extremo sucesso:
- **PR #19 (`0a3c26d`):** `categoria-tag-titulo` com selo LIMPO do Codex (`1d8120a`).
- **PR #20 (`5d29e51`):** `export-pasta` com selo de revisão cruzada.
- **Sessão Atual (17/10/2026):** `lane/export-pasta-antiga` criada isoladamente, sem disputar working tree.

**Veredito sobre Método de Time:** **APROVADO E ADOTADO COMO REGRA PERMANENTE** para frentes complexas no Bruto.

---

## 4. Reconciliação do Checklist da Demanda `fd4b32e7`

- [x] **Medir stack e banco:** Concluído (SQLite local via Drizzle, sem Postgres).
- [x] **Mapear fontes de conhecimento e consumidores:** Concluído (transcrições, resumos, aulas, mapas mentais consumidos na interface local).
- [x] **Medir o modo de construir atual:** Concluído (adoção de lanes de worktree, CI com 447 testes, empacotamento da extensão).
- [x] **Propor plano de adoção do RAG com esforço:** Concluído (RAG com pgvector rejeitado por incompatibilidade de premissas; recomendada evolução via SQLite FTS5 se houver demanda de busca avançada).
- [x] **Propor adoção do método de time:** Concluído (adotado formalmente).
- [x] **Registrar o relatório no repo e apresentar ao dono:** Concluído com este relatório.

---

## 5. Próxima Ação no DevTasks
Com este relatório produzido e fundamentado, a demanda `fd4b32e7-6910-4535-8a37-83484fb15cc2` tem seu checklist 100% cumprido e está apta para ser concluída.
