/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional API origin. Omit to use same-origin (Vite proxy → :4000). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}