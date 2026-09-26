# A pasta de exportação escolhida no Chrome é sempre cópia, nunca a fonte de verdade

Um leitor futuro perguntaria por que o app não grava os artefatos direto na pasta que a pessoa
escolhe, em vez de copiar depois. A resposta é um limite de arquitetura, não de preferência: o
Bruto continua sendo um app Next.js comum, servido numa aba do Chrome, sem runtime tipo
Electron. Quem baixa vídeo, transcreve e escreve arquivo é o processo Node do servidor; quem
recebe a permissão de pasta da pessoa (File System Access API) é o contexto JavaScript da aba —
os dois não compartilham esse handle.

Decisão: `~/.bruto/library/<id>/` continua sendo a única fonte de verdade, escrita pelo
servidor como hoje. A pasta escolhida no Chrome é sempre um destino de cópia, disparado depois
que o vídeo termina de processar — nunca o lugar onde o pipeline grava. Trade-off: exige uma
etapa extra de cópia em vez de um único ponto de escrita, mas evita reescrever o pipeline
inteiro para rodar dentro do contexto restrito de uma aba de navegador.
