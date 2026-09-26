/**
 * Normalização e reaproveitamento de tags — puro, sem I/O, para poder testar
 * a garantia que o dono pediu (nunca duplicar tag pro mesmo assunto) sem
 * precisar de banco.
 *
 * O slug é a CHAVE de reaproveitamento real (`db/queries.ts` cria/reusa por
 * slug único em `tags`); esta função só decide, a partir de uma lista de
 * slugs já conhecidos, quais nomes sugeridos pela IA batem com algo existente.
 */

/** Mesmo formato de `slugify` em `db/queries.ts` (sem acento, minúsculo, hífens) — duplicado de propósito: um é sobre `filoes` (nome livre, permite colisão), este é sobre `tags` (colisão de slug É o reaproveitamento). */
export function slugifyTag(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export interface TagResolution {
  /** Nome como veio da IA, só aparado. */
  name: string;
  slug: string;
  /** true quando o slug já existia em `existingSlugs`. */
  reused: boolean;
}

/**
 * Para cada nome de tag sugerido, decide se ele casa com um slug já existente
 * ou se precisa nascer novo. Deduplica dentro da própria resposta (a IA pode
 * repetir sinônimos que colapsam no mesmo slug).
 */
export function resolveTagNames(
  names: readonly string[],
  existingSlugs: readonly string[],
): TagResolution[] {
  const existing = new Set(existingSlugs);
  const seen = new Set<string>();
  const out: TagResolution[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const slug = slugifyTag(name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    out.push({ name, slug, reused: existing.has(slug) });
  }
  return out;
}
