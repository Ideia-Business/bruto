/** Tipos leves usados pelos client components (sem importar código de servidor). */

export interface BrutoCard {
  id: string;
  platform: string;
  title: string;
  channel: string | null;
  durationSec: number | null;
  thumbnailPath: string | null;
  categoryId: number | null;
  transcriptSource: string | null;
  createdAt: string | number | Date;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  sortOrder: number;
}

export interface CategoryRow {
  category: Category;
  brutos: BrutoCard[];
}

export interface Job {
  id: string;
  videoId: string | null;
  url: string;
  status: "queued" | "running" | "done" | "error";
  currentStep: string | null;
  progressPct: number;
  errorCode: string | null;
  errorMessage: string | null;
  forceWhisper: boolean | null;
  translate: boolean | null;
  createdAt: string | number | Date;
}

export interface CatalogResponse {
  hero: BrutoCard | null;
  catalog: CategoryRow[];
  history: BrutoCard[];
  activeJobs: Job[];
}

export interface JobProgressEvent {
  jobId: string;
  videoId: string | null;
  status: "queued" | "running" | "done" | "error";
  step: string | null;
  progressPct: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface Filao {
  id: string;
  name: string;
  slug: string;
  sortOrder: number;
  createdAt: string | number | Date;
}

export interface FilaoRow {
  filao: Filao;
  count: number;
}
