/**
 * O renderizador de markdown da Aula — separado do popup para poder ser TESTADO.
 *
 * Ele é a fronteira de segurança da extensão: o texto que entra aqui foi escrito
 * por um modelo de IA a partir da transcrição de um vídeo de terceiro, e o que
 * sai daqui vai para `innerHTML`. Enquanto vivia dentro de `popup.ts`, junto de
 * chamadas a `chrome.*`, nenhum teste conseguia carregá-lo.
 */
export function escapar(t: string): string {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Markdown à mão: títulos, negrito, itálico, código, listas e parágrafos.
 *
 * O ÚNICO HTML aceito da resposta do modelo é `<details>`/`<summary>`, e mesmo
 * esses não são repassados: são RECONHECIDOS e as tags que saem daqui são
 * escritas por este código, sem atributo nenhum. O texto entre elas continua
 * passando por `escapar()` como todo o resto.
 *
 * Por que abrir essa exceção: a seção "Teste seu entendimento" da aula esconde
 * cada resposta num `<details>`. Escapando tudo, o leitor via `<details>` escrito
 * por extenso e a resposta ao lado da pergunta — o teste deixava de ser teste.
 *
 * Por que não liberar HTML geral: este markdown vem de um modelo de IA, que por
 * sua vez leu a transcrição de um vídeo de terceiro. É entrada não-confiável em
 * dois saltos, e `innerHTML` com ela dentro é XSS na extensão — com acesso ao
 * `chrome.storage` onde mora a chave de quem usa. Reconhecer duas tags fechadas
 * é seguro; repassar o que o modelo mandar não é.
 */
export function renderMarkdown(md: string): string {
  const linhas = md.replace(/\r\n/g, "\n").split("\n");
  const saida: string[] = [];
  let lista: "ul" | "ol" | null = null;
  let paragrafo: string[] = [];
  let detalhesAbertos = 0;

  const inline = (t: string): string =>
    escapar(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

  const fecharParagrafo = (): void => {
    if (paragrafo.length > 0) {
      saida.push(`<p>${inline(paragrafo.join(" "))}</p>`);
      paragrafo = [];
    }
  };

  const fecharLista = (): void => {
    if (lista) {
      saida.push(`</${lista}>`);
      lista = null;
    }
  };

  for (const linha of linhas) {
    const bruta = linha.trim();

    if (bruta === "") {
      fecharParagrafo();
      fecharLista();
      continue;
    }

    // `<details>` sozinho, ou já com o `<summary>` na mesma linha — o prompt pede
    // a segunda forma, mas modelo nenhum é fiel o bastante para se apostar nisso.
    const abre = /^<details>\s*(?:<summary>(.*?)<\/summary>)?\s*$/i.exec(bruta);
    if (abre) {
      fecharParagrafo();
      fecharLista();
      saida.push("<details>");
      if (abre[1] !== undefined) saida.push(`<summary>${inline(abre[1])}</summary>`);
      detalhesAbertos++;
      continue;
    }

    const sumario = /^<summary>(.*?)<\/summary>$/i.exec(bruta);
    if (sumario && detalhesAbertos > 0) {
      fecharParagrafo();
      fecharLista();
      saida.push(`<summary>${inline(sumario[1])}</summary>`);
      continue;
    }

    // Fecha só o que foi aberto: `</details>` órfão vira texto, como qualquer
    // outra coisa que o modelo escreva fora do combinado.
    if (/^<\/details>$/i.test(bruta) && detalhesAbertos > 0) {
      fecharParagrafo();
      fecharLista();
      saida.push("</details>");
      detalhesAbertos--;
      continue;
    }

    const titulo = /^(#{1,3})\s+(.*)$/.exec(bruta);
    if (titulo) {
      fecharParagrafo();
      fecharLista();
      const nivel = titulo[1].length;
      saida.push(`<h${nivel}>${inline(titulo[2])}</h${nivel}>`);
      continue;
    }

    const item = /^[-*]\s+(.*)$/.exec(bruta);
    if (item) {
      fecharParagrafo();
      if (lista !== "ul") {
        fecharLista();
        saida.push("<ul>");
        lista = "ul";
      }
      saida.push(`<li>${inline(item[1])}</li>`);
      continue;
    }

    const numerado = /^\d+[.)]\s+(.*)$/.exec(bruta);
    if (numerado) {
      fecharParagrafo();
      if (lista !== "ol") {
        fecharLista();
        saida.push("<ol>");
        lista = "ol";
      }
      saida.push(`<li>${inline(numerado[1])}</li>`);
      continue;
    }

    fecharLista();
    paragrafo.push(bruta);
  }

  fecharParagrafo();
  fecharLista();
  // Resposta cortada no meio (teto de tokens, rede) deixaria um `<details>` sem
  // fechamento, e o navegador engoliria o resto da aula dentro dele.
  while (detalhesAbertos > 0) {
    saida.push("</details>");
    detalhesAbertos--;
  }
  return saida.join("");
}
