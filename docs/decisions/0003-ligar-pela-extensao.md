# A extensão liga o app local por native messaging, não por início automático no login

Um leitor futuro perguntaria por que o Bruto não simplesmente sobe sozinho quando a pessoa liga o
computador. A resposta é onde a falta do app aparece: na extensão, no meio de um "Destrinchar no
app local", e não no boot. Um serviço de login (LaunchAgent, pasta Inicializar, autostart) deixaria
o Node rodando o tempo todo para quem usa o app de vez em quando, não volta sozinho se o servidor
cair, mantém a versão antiga no ar depois de uma atualização e, no macOS, pode avisar "item de
segundo plano adicionado" com o nome de um script — ruim para quem nunca abriu um terminal.

Decisão: a extensão liga o app quando precisa dele, por Chrome native messaging. O instalador
registra um host (`com.ideiabusiness.bruto`) que aceita só comandos fixos e sobe o `launcher/serve`
sem abrir janela. A permissão `nativeMessaging` é opcional e pedida no primeiro clique: quem usa só
o YouTube nunca vê o aviso "comunicar com aplicativos nativos".

O detalhe que não é óbvio: o Chrome encerra o grupo de processos inteiro do host quando a conversa
acaba. Num teste no macOS (Chromium, 01/10/2026), um servidor iniciado com `nohup … &` — como o
`serve.sh` fazia — morreu nos três cenários (resposta única, conectar e desconectar, fechar o
navegador); só o iniciado numa sessão própria (`setsid`) sobreviveu aos três. Por isso o host
inicia o servidor numa sessão nova, e não basta chamar o launcher como ele é.

Trade-off: mais peças que um item de login — o host, o registro por navegador e por sistema, e um
ID de extensão fixo que o host conhece — em troca de nenhum processo parado quando ninguém usa e de
o app voltar no próprio clique que precisou dele.
