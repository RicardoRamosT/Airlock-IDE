import type { AirlockApi } from "../../shared/ipc";

declare global {
  interface Window {
    airlock: AirlockApi;
  }
}
