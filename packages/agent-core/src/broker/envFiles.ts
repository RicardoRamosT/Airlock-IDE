// Which root-level files the multi-file .env import touches, and in what
// order. Pure string logic (no fs) so it is trivially unit-testable; the
// readdir + loop live in broker.ts importAllDotEnv.

// Template/encrypted conventions that must NEVER be auto-imported: with
// deleteAfter they would vault placeholder values AND delete the file.
// (Matches the repo .gitignore stance: .env/.env.* ignored, !.env.example kept.)
export const EXCLUDED_ENV_SUFFIXES = [
  ".example",
  ".sample",
  ".template",
  ".dist",
  ".vault",
];

// .env exactly, or any .env.* — minus the excluded suffixes. .envrc fails the
// prefix rule on purpose (direnv shell script, not dotenv format).
export function isImportableEnvFile(name: string): boolean {
  if (name !== ".env" && !name.startsWith(".env.")) return false;
  return !EXCLUDED_ENV_SUFFIXES.some((s) => name.endsWith(s));
}

// Import order = duplicate-key precedence: setSecret upserts, so the LAST
// write wins. .env first, then non-.local lexicographically, then .local
// lexicographically — local overrides shared, matching dotenv-flow/Vite/Next.
export function sortEnvFiles(names: string[]): string[] {
  const rank = (n: string) => (n === ".env" ? 0 : n.endsWith(".local") ? 2 : 1);
  return [...names].sort(
    (a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0),
  );
}
