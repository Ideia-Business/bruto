import { EventEmitter } from "node:events";
import type { JobProgress } from "./types";

/**
 * Barramento de progresso dos jobs. Vive em globalThis para sobreviver ao
 * hot reload do `next dev` — na Fase 2 as rotas SSE assinam este emitter.
 * O estado REAL de cada job mora no SQLite; o bus é só o canal de push imediato.
 */
const globalForBus = globalThis as unknown as { __resumeVideoBus?: EventEmitter };

export const bus: EventEmitter = globalForBus.__resumeVideoBus ?? new EventEmitter();
bus.setMaxListeners(0); // sem teto — várias abas podem assinar o mesmo job
globalForBus.__resumeVideoBus = bus;

/** Emite um snapshot de progresso (evento por-job + evento global). */
export function emitProgress(progress: JobProgress): void {
  bus.emit(`job:${progress.jobId}`, progress);
  bus.emit("job:*", progress);
}
