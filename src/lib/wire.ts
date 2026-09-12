/**
 * A fronteira HTTP — onde o léxico interno vira o nome publicado.
 *
 * Dentro do app o material chama-se **bruto** (BRAND.md): a tabela, as queries,
 * os tipos de domínio, os componentes. Mas o que atravessa HTTP é contrato com
 * o mundo, e contrato não se renomeia de graça — as rotas `/api/videos/*` e
 * `/video/[id]` ficaram como estavam, e por coerência as CHAVES do payload
 * também: `videos` e `video`, como sempre foram.
 *
 * Rota preservada com payload renomeado seria o pior dos dois mundos: quem
 * chama continua achando o endereço e quebra ao ler a resposta. Então a
 * conversão acontece aqui, num lugar só, e não espalhada por cada handler.
 *
 * Regra para quem mexer: nada que devolva JSON ao cliente monta o objeto à mão
 * — passa por uma destas funções.
 */
import type { BrutoCard, BrutoDetail, CategoryRow as CategoryRowInterna } from "@/db/queries";
import type { Job as JobDoBanco } from "@/db/schema";
import type { CatalogResponse, Job } from "@/lib/api-types";

interface EntradaCatalogo {
  hero: BrutoCard | null;
  catalog: CategoryRowInterna[];
  history: BrutoCard[];
  activeJobs: JobDoBanco[];
}

/**
 * No SQLite `jobs.status` é `text` livre; no contrato publicado é uma união de
 * quatro valores. Quem grava a coluna é só o runner do pipeline, e só com esses
 * quatro — mas o tipo do banco não sabe disso, e é aqui que a diferença se
 * resolve, explicitamente, em vez de um `as unknown as` engolindo o objeto todo.
 */
function jobParaWire(job: JobDoBanco): Job {
  return { ...job, status: job.status as Job["status"] };
}

/** Catálogo da home: `catalog[].brutos` (interno) sai como `catalog[].videos`. */
export function catalogoParaWire(entrada: EntradaCatalogo): CatalogResponse {
  return {
    hero: entrada.hero,
    catalog: entrada.catalog.map((row) => ({
      category: row.category,
      videos: row.brutos,
    })),
    history: entrada.history,
    activeJobs: entrada.activeJobs.map(jobParaWire),
  };
}

/** Detalhe de um bruto: o campo `bruto` (interno) sai como `video`. */
export function detalheParaWire(detalhe: BrutoDetail): Omit<BrutoDetail, "bruto"> & {
  video: BrutoDetail["bruto"];
} {
  const { bruto, ...resto } = detalhe;
  return { video: bruto, ...resto };
}
