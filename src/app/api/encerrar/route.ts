/**
 * POST /api/encerrar — o botão "Encerrar o Bruto" (demanda 43fe2879).
 *
 * Desliga o servidor do PRÓPRIO Bruto e libera a porta. A lógica (decisão
 * 202×409, morte dos filhos, regra do pid, exit) vive injetável em
 * `src/lib/encerrar.ts`; a casca com injeção (para o teste) vive na FÁBRICA
 * `./factory.ts` — a assinatura exportada daqui tem de satisfazer o contrato
 * de rota do Next (`{ params: Promise<…> }` como segundo parâmetro, validado
 * pelo `next build` em `.next/types/validator.ts`), por isso as deps não
 * podem entrar por ela.
 *
 * Segurança — esta é a única rota do app que derruba o processo:
 *   - Host: só loopback (`recusarSeNaoForLocal`, a mesma trava das rotas
 *     `/api/llm*`), ANTES de qualquer outra decisão — barra o IP da máquina
 *     na rede local e o DNS rebinding (domínio de fora que resolve para
 *     127.0.0.1 e chega como "same-origin" com o `Host` do atacante);
 *   - origem: só `Sec-Fetch-Site: same-origin` COM Host de loopback (a janela
 *     do app) ou `Origin` exatamente igual à origem do próprio servidor
 *     (`http://127.0.0.1:<porta>` ou `http://localhost:<porta>`). Qualquer
 *     outro caso → 403 `{ok:false, code:"origem-recusada"}` — um site aberto
 *     num separador não encerra o Bruto de ninguém;
 *   - corpo JSON obrigatório (`Content-Type: application/json`), o que obriga
 *     preflight em pedido cross-site de navegador.
 *
 * Respostas:
 *   202 {ok:true}                          encerra ~300 ms depois de responder
 *   409 {ok:false, code:"processamento-em-andamento", ativos:n}
 *                                          job running/queued sem {"confirmar":true}
 */
import { criarPostEncerrar } from "./factory";

export const dynamic = "force-dynamic";

export const POST = criarPostEncerrar();
