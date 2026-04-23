/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RK_POOL_IDLE_TIMEOUT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
