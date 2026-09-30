/**
 * A lib.dom.d.ts do TypeScript instalado (5.9.3) inclui `FileSystemDirectoryHandle`
 * e `FileSystemFileHandle` (parte da OPFS), mas não os métodos de permissão nem
 * `showDirectoryPicker` — a parte da File System Access API que dá acesso a uma
 * pasta real do disco escolhida pela pessoa. Estende via `declare global`.
 */
export {};

declare global {
  type FileSystemPermissionMode = "read" | "readwrite";

  interface FileSystemHandlePermissionDescriptor {
    mode?: FileSystemPermissionMode;
  }

  interface FileSystemHandle {
    queryPermission(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<PermissionState>;
    requestPermission(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<PermissionState>;
  }

  interface DirectoryPickerOptions {
    id?: string;
    mode?: FileSystemPermissionMode;
    startIn?:
      | FileSystemHandle
      | "desktop"
      | "documents"
      | "downloads"
      | "music"
      | "pictures"
      | "videos";
  }

  interface Window {
    showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
  }

  /**
   * Iteração do diretório — também ausente do lib.dom.d.ts instalado. Usada
   * só para SONDAR se a pasta ainda existe no disco (`values().next()`,
   * sem ler o conteúdo inteiro): `queryPermission` continua dizendo
   * "granted" mesmo com a pasta apagada — só uma operação real revela isso.
   */
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    keys(): AsyncIterableIterator<string>;
    values(): AsyncIterableIterator<FileSystemHandle>;
  }
}
