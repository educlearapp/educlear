/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_FEE_CHECK_BUILD_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
