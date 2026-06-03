import type { AirlockApi } from "../../shared/ipc";

declare global {
  interface Window {
    airlock: AirlockApi;
  }
}

// biome-ignore lint/complexity/noUselessEmptyExport: module-scope anchor per spec — keeps declare-global scoped even if the import above is ever removed
export {};
