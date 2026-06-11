import { describe, expect, it } from "vitest";
import type { EnvFileImport, SecretMeta } from "../../../shared/ipc";
import { formatEnvImportSummary } from "./envImportSummary";

const meta = (name: string): SecretMeta => ({ name }) as SecretMeta;

const okResult = (
  imported: string[],
  extra: Partial<{
    skipped: string[];
    failed: string[];
    deleted: boolean;
  }> = {},
) => ({
  imported: imported.map(meta),
  skipped: extra.skipped ?? [],
  failed: extra.failed ?? [],
  deleted: extra.deleted ?? false,
});

describe("formatEnvImportSummary", () => {
  it("says when nothing was found", () => {
    expect(formatEnvImportSummary([])).toBe("No .env files found to import");
  });

  it("summarizes counts, files, and deletions", () => {
    const results: EnvFileImport[] = [
      { file: ".env", result: okResult(["A", "B"], { deleted: true }) },
      { file: ".env.local", result: okResult(["C"]) },
    ];
    expect(formatEnvImportSummary(results)).toBe(
      "Imported 3 from .env, .env.local; deleted: .env",
    );
  });

  it("lists skipped and failed names", () => {
    const results: EnvFileImport[] = [
      {
        file: ".env",
        result: okResult(["A"], { skipped: ["EMPTY"], failed: ["LOCKED"] }),
      },
    ];
    expect(formatEnvImportSummary(results)).toBe(
      "Imported 1 from .env; skipped: EMPTY; failed: LOCKED",
    );
  });

  it("reports per-file errors, even when no file succeeded", () => {
    const results: EnvFileImport[] = [
      { file: ".env.local", error: "EACCES: permission denied" },
    ];
    expect(formatEnvImportSummary(results)).toBe(
      "Imported 0; errors: .env.local: EACCES: permission denied",
    );
  });
});
