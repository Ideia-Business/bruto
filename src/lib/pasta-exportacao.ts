/**
 * Persistência da pasta de exportação escolhida pela pessoa (File System Access
 * API). Um `FileSystemDirectoryHandle` não serializa em `localStorage`, mas é
 * estruturalmente clonável — por isso vive no IndexedDB, não ali.
 *
 * A pasta é sempre CÓPIA (ADR 0002): `~/.bruto/library/<id>/`, escrita pelo
 * servidor, continua sendo a única fonte de verdade. Nada aqui bloqueia ou
 * substitui esse caminho — na pior hipótese, a cópia falha e o vídeo processado
 * segue intacto.
 */

const DB_NAME = "bruto-exportacao";
const DB_VERSION = 1;
const STORE = "config";
const CHAVE_PASTA = "pastaHandle";
const CHAVE_PASTA_ID = "pastaId";
const CHAVE_LOCALSTORAGE_AUTO = "bruto:exportar-automaticamente";

function abrirDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(chave: string): Promise<T | undefined> {
  const db = await abrirDB();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(chave);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbSet(chave: string, valor: unknown): Promise<void> {
  const db = await abrirDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(valor, chave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbDelete(chave: string): Promise<void> {
  const db = await abrirDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(chave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Chromium expõe `showDirectoryPicker`; Safari e Firefox não — limitação aceita (ADR 0002). */
export function suportaPastaLocal(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.showDirectoryPicker === "function" &&
    typeof indexedDB !== "undefined"
  );
}

/** Handle salvo de uma sessão anterior, ou `null` se nunca escolhido / erro ao ler. */
export async function obterPastaSalva(): Promise<FileSystemDirectoryHandle | null> {
  if (!suportaPastaLocal()) return null;
  try {
    return (await idbGet<FileSystemDirectoryHandle>(CHAVE_PASTA)) ?? null;
  } catch {
    return null;
  }
}

export async function esquecerPastaEscolhida(): Promise<void> {
  await idbDelete(CHAVE_PASTA);
  await idbDelete(CHAVE_PASTA_ID);
}

/**
 * Identidade opaca da pasta ATUALMENTE escolhida — gerada de novo a cada
 * `escolherPasta()` bem-sucedida. Escopa as marcas de "já exportado"
 * (`src/lib/exportar-artefatos.ts`) por pasta: sem isto, trocar de A para uma
 * pasta B vazia mantinha as marcas de A, e o catch-up pulava todo vídeo já
 * marcado — B nunca recebia cópia nenhuma. `null` = nenhuma pasta escolhida
 * ainda (ou navegador sem suporte).
 */
export async function obterPastaId(): Promise<string | null> {
  if (!suportaPastaLocal()) return null;
  try {
    return (await idbGet<string>(CHAVE_PASTA_ID)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Abre o seletor de pastas do sistema (exige gesto do usuário — um clique).
 * `null` quando a pessoa cancela; nunca lança nesse caso.
 */
export async function escolherPasta(): Promise<FileSystemDirectoryHandle | null> {
  if (!suportaPastaLocal()) return null;
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    // Toda escolha bem-sucedida — inclusive escolher a "mesma" pasta de novo
    // pelo botão "Trocar" — gera uma identidade nova. As marcas de exportado
    // da pasta anterior ficam órfãs (não apagadas, só fora de escopo): o
    // catch-up parte de zero para a pasta atual, sem precisar comparar
    // identidade de pasta (que a API nem expõe de forma confiável).
    await idbSet(CHAVE_PASTA, handle);
    await idbSet(CHAVE_PASTA_ID, crypto.randomUUID());
    return handle;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

/** Consulta a permissão SEM pedir — não exige gesto do usuário. Use antes de escrever automaticamente. */
export async function permissaoAtual(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  try {
    return await handle.queryPermission({ mode: "readwrite" });
  } catch {
    return "denied";
  }
}

/** Pede a permissão de novo. Só funciona chamada a partir de um gesto do usuário (clique). */
export async function pedirPermissao(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  try {
    return await handle.requestPermission({ mode: "readwrite" });
  } catch {
    return "denied";
  }
}

export function autoExportarAtivado(): boolean {
  try {
    return localStorage.getItem(CHAVE_LOCALSTORAGE_AUTO) === "1";
  } catch {
    return false;
  }
}

export function definirAutoExportar(ativo: boolean): void {
  try {
    localStorage.setItem(CHAVE_LOCALSTORAGE_AUTO, ativo ? "1" : "0");
  } catch {
    /* modo privado ou storage bloqueado — a preferência só não persiste */
  }
}

/**
 * Trunca por BYTES UTF-8, nunca no meio de um caractere multi-byte (emoji,
 * CJK, acentos). É a mesma técnica de `truncarUtf8SemPartirCaractere` em
 * `servidor/lib/ollama.ts` (modo grátis) — reimplementada aqui, e não
 * importada de lá, para não acoplar o app Next.js ao servidor separado do
 * modo grátis (deploy independente, sem dependência entre os dois).
 *
 * Por que por bytes e não por `.length`: `.length` conta unidades UTF-16, não
 * bytes. Um título de 150 "caracteres" JS passa folgado num `.slice(0, 150)`,
 * mas se for muito CJK (3 bytes cada em UTF-8) ou emoji (4 bytes) pode
 * estourar bem os 255 bytes que é o teto real de um componente de caminho em
 * APFS/ext4/NTFS — `getDirectoryHandle`/`getFileHandle` rejeita, o catch
 * confunde com "pasta sumiu", e o catch-up repete pra sempre sem nunca
 * marcar (a mesma classe de bug do item 3, causa diferente).
 */
function truncarPorBytesUtf8(texto: string, limiteBytes: number): string {
  const bytes = new TextEncoder().encode(texto);
  if (bytes.length <= limiteBytes) return texto;
  let fim = limiteBytes;
  // O byte na fronteira é de continuação (`10xxxxxx`) → o corte caiu no meio
  // de uma sequência multi-byte. Recua até o byte de abertura dessa
  // sequência e exclui o caractere inteiro.
  if ((bytes[fim] & 0xc0) === 0x80) {
    while (fim > 0 && (bytes[fim] & 0xc0) === 0x80) fim--;
  }
  return new TextDecoder("utf-8").decode(bytes.subarray(0, fim));
}

/**
 * Teto de um componente de caminho (pasta ou arquivo) em BYTES UTF-8 — 255 é
 * o limite real de APFS, ext4 e NTFS. Fica bem abaixo dele: o nome sanitizado
 * sozinho ainda vai ganhar o sufixo `(videoId)` em `nomeDaPastaDoVideo`.
 */
const LIMITE_BYTES_NOME = 200;

/**
 * Remove o que os três SOs comuns rejeitam num nome de pasta/arquivo (Windows
 * é o mais restritivo — a régua usada aqui): caracteres de controle
 * (`\u0000`–`\u001f`), os separadores/reservados `/ \ ? % * : | " < >`, ponto
 * final (Windows recusa "Espere..." como nome) e os nomes puros `.`/`..`
 * (recusados pela própria File System Access API). Sem isto,
 * `getDirectoryHandle`/`getFileHandle` REJEITA a promessa e a exportação
 * inteira cai no catch com um aviso que parece problema de permissão — e não
 * é. Por isso a limpeza acontece aqui, antes de qualquer tentativa de criar
 * pasta ou arquivo, nunca depois de uma falha.
 */
export function sanitizarNomeArquivo(nome: string): string {
  let limpo = nome
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/[/\\?%*:|"<>]/g, "-")
    .trim();
  limpo = limpo.replace(/\.+$/, "").trim();
  limpo = truncarPorBytesUtf8(limpo, LIMITE_BYTES_NOME).replace(/\.+$/, "").trim();
  if (limpo === "" || limpo === "." || limpo === "..") return "Sem título";
  return limpo;
}

/**
 * Nome de pasta do vídeo — título + `(videoId)`. Dois vídeos DIFERENTES podem
 * ter o mesmo título (mesmo dentro da mesma categoria); sem o id, o segundo
 * sobrescreveria os arquivos do primeiro em silêncio. O id nunca é cortado
 * pelo teto de tamanho: o título é que cede espaço para ele caber inteiro —
 * por BYTES (`videoId` é sempre ASCII, então o cálculo do sufixo é honesto
 * tanto em bytes quanto em chars, mas o título não é).
 */
export function nomeDaPastaDoVideo(tituloSanitizado: string, videoId: string): string {
  const sufixo = ` (${videoId})`;
  const bytesSufixo = new TextEncoder().encode(sufixo).length;
  const disponivelParaTitulo = Math.max(LIMITE_BYTES_NOME - bytesSufixo, 1);
  return `${truncarPorBytesUtf8(tituloSanitizado, disponivelParaTitulo)}${sufixo}`;
}
