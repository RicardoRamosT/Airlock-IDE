// service.ts -- what the eslint:* IPC handlers call. Electron-free, deps
// injected, so the security invariant is unit-tested: a lint of an untrusted
// unit never reaches the pool.
//
// The unit is re-derived from relPath and trust re-checked on EVERY call. The
// renderer's idea of "trusted" is a display hint, never an authorisation: a
// renderer bug (or a revoked grant it has not heard about yet) must not be
// able to run repo code the user did not approve.
import path from "node:path";
import type { EslintLintResult, EslintStatus } from "../../shared/ipc";
import type { EslintPool } from "./pool";
import type { TrustStore } from "./trust";
import {
  ESLINT_CONFIG_NAMES,
  eslintInstalled,
  findEslintUnit,
  isLintablePath,
} from "./unit";

export interface EslintServiceDeps {
  exists(abs: string): boolean;
  trust: Pick<TrustStore, "isTrusted" | "set">;
  pool: Pick<EslintPool, "lint" | "disposeUnit">;
}

// A root-relative path that stays inside the root by construction: not
// absolute, no ".." segment, no NUL. ("" is the root itself -- valid for a
// unit, never for a file.)
function isSafeRel(rel: string): boolean {
  if (rel.includes("\0") || path.isAbsolute(rel)) return false;
  return !rel.split(/[/\\]/).includes("..");
}

export function createEslintService(d: EslintServiceDeps) {
  const inRoot = (root: string) => (rel: string) =>
    d.exists(path.join(root, rel));

  const unitOf = (root: string, relPath: string): string | null =>
    relPath && isSafeRel(relPath) && isLintablePath(relPath)
      ? findEslintUnit(relPath, inRoot(root))
      : null;

  return {
    status(root: string, relPath: string): EslintStatus {
      const unit = unitOf(root, relPath);
      if (unit === null) return { state: "none", unit: null };
      if (!eslintInstalled(unit, inRoot(root)))
        return { state: "missing-eslint", unit };
      return {
        state: d.trust.isTrusted(path.join(root, unit))
          ? "trusted"
          : "untrusted",
        unit,
      };
    },

    setTrust(root: string, unitRel: string, on: boolean): void {
      if (!isSafeRel(unitRel)) throw new Error("Invalid ESLint folder");
      // Only a real unit can be trusted: a folder holding a flat config.
      if (!ESLINT_CONFIG_NAMES.some((n) => inRoot(root)(path.join(unitRel, n))))
        throw new Error("That folder has no ESLint config");
      const abs = path.join(root, unitRel);
      d.trust.set(abs, on);
      if (!on) d.pool.disposeUnit(abs);
    },

    async lint(
      root: string,
      relPath: string,
      version: number,
      text: string,
    ): Promise<EslintLintResult> {
      const unit = unitOf(root, relPath);
      if (unit === null || !d.trust.isTrusted(path.join(root, unit)))
        return { version, untrusted: true };
      const out = await d.pool.lint(
        path.join(root, unit),
        path.join(root, relPath),
        text,
      );
      if ("messages" in out) return { version, messages: out.messages };
      if ("configError" in out)
        return { version, configError: out.configError };
      if ("timedOut" in out)
        return { version, configError: "ESLint timed out" };
      return { version, superseded: true };
    },
  };
}

export type EslintService = ReturnType<typeof createEslintService>;
