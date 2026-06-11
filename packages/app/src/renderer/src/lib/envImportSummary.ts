import type { EnvFileImport } from "../../../shared/ipc";

// One human line for the multi-file import outcome. Pure (unit-tested);
// SecretsSection just renders the string.
export function formatEnvImportSummary(results: EnvFileImport[]): string {
  if (results.length === 0) return "No .env files found to import";
  const imported = results.reduce(
    (n, r) => n + (r.result?.imported.length ?? 0),
    0,
  );
  const fromFiles = results.filter((r) => r.result).map((r) => r.file);
  const deleted = results.filter((r) => r.result?.deleted).map((r) => r.file);
  const skipped = results.flatMap((r) => r.result?.skipped ?? []);
  const failed = results.flatMap((r) => r.result?.failed ?? []);
  const errors = results
    .filter((r) => r.error)
    .map((r) => `${r.file}: ${r.error}`);
  const parts = [
    fromFiles.length > 0
      ? `Imported ${imported} from ${fromFiles.join(", ")}`
      : "Imported 0",
  ];
  if (deleted.length > 0) parts.push(`deleted: ${deleted.join(", ")}`);
  if (skipped.length > 0) parts.push(`skipped: ${skipped.join(", ")}`);
  if (failed.length > 0) parts.push(`failed: ${failed.join(", ")}`);
  if (errors.length > 0) parts.push(`errors: ${errors.join("; ")}`);
  return parts.join("; ");
}
