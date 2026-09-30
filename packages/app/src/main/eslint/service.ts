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
  /** null = does not exist. */
  realpath(abs: string): string | null;
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

  // The file's REAL directory must be inside the unit's real directory, with no
  // folder in between holding a config of its own -- that folder would be a
  // separate unit with its own trust decision.
  const reallyInUnit = (unitAbs: string, fileDir: string): boolean => {
    const realUnit = d.realpath(unitAbs);
    let dir = d.realpath(fileDir);
    if (realUnit === null || dir === null) return false;
    if (dir !== realUnit && !dir.startsWith(realUnit + path.sep)) return false;
    while (dir !== realUnit) {
      const here = dir;
      if (ESLINT_CONFIG_NAMES.some((n) => d.exists(path.join(here, n))))
        return false;
      dir = path.dirname(dir);
    }
    return true;
  };

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
      const unitAbs = path.join(root, unit);
      const fileAbs = path.join(root, relPath);
      // The unit was found by walking the path AS WRITTEN; a symlink can put
      // the file's real location somewhere else entirely. The worker pins its
      // unit's config (it never looks one up), so linting a foreign file would
      // apply this unit's rules to code they were not written for -- and before
      // the pin, ESLint 10's lookup from the file's REAL directory ran a config
      // nobody trusted. Refuse unless the file really lives inside the unit.
      if (!reallyInUnit(unitAbs, path.dirname(fileAbs)))
        return {
          version,
          configError:
            "This file really lives in a different ESLint folder (it is reached through a symlink), so it is not linted here.",
        };
      const out = await d.pool.lint(unitAbs, fileAbs, text);
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
