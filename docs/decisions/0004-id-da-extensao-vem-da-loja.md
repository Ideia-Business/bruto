# O ID de produção da extensão vem do item da loja, e o registrador aceita vários IDs

O host nativo só atende a extensão listada em `allowed_origins`, e esse ID não existia: o manifest
não tem `key` e a extensão ainda não está na Chrome Web Store. Decisão: o ID de produção é o do item
criado na loja (a chave pública do item entra em `key`), nunca uma chave que geramos por conta própria,
e o `registrar-host.sh` passa a aceitar **vários** IDs (`--extensao-id` repetível; `BRUTO_EXTENSAO_ID`
com lista) para o ID da extensão descompactada, usado no teste, coexistir com o da loja.

O detalhe que não é óbvio: gerar uma `key` própria parece resolver o ID já, mas o ID que a loja atribui
ao item vem da chave dela; se as duas divergirem, o host fica liberado para uma extensão que ninguém
instala e fechado para a que as pessoas têm. Trade-off: depender do dono para criar o item (rascunho)
antes da publicação, em troca de nunca registrar um ID que não é o do produto.
