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
}

/**
 * Abre o seletor de pastas do sistema (exige gesto do usuário — um clique).
 * `null` quando a pessoa cancela; nunca lança nesse caso.
 */
export async function escolherPasta(): Promise<FileSystemDirectoryHandle | null> {
  if (!suportaPastaLocal()) return null;
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await idbSet(CHAVE_PASTA, handle);
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

/** Remove caracteres inválidos em nomes de pasta/arquivo (Windows é o mais restritivo dos SOs comuns). */
export function sanitizarNomeArquivo(nome: string): string {
  const limpo = nome.replace(/[/\\?%*:|"<>]/g, "-").trim().slice(0, 150);
  return limpo || "sem-nome";
}
