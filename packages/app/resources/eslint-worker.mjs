// eslint-worker.mjs -- runs the PROJECT's own ESLint for one unit, kept warm.
//
// Spawned by main (src/main/eslint/wire.ts) as plain Node via
// ELECTRON_RUN_AS_NODE, and ONLY after the user trusted this folder: loading
// the ESLint below executes the repo's eslint.config.* and every plugin it
// imports. cwd = the unit (the folder holding the config). Shipped via
// extraResources because a child process cannot load from the asar.
//
// Protocol: newline-delimited JSON on stdin/stdout (see src/main/eslint/
// protocol.ts). Request {id, op:"lint", filePath, text}; response
// {id, messages} or {id, configError}. Messages are passed through in ESLint's
// own shape (1-based line/column; fix = a character-range edit).
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// process.cwd() is already the REAL path (the OS resolves symlinks for it).
const unit = process.cwd();

// Main sends the path as the user opened it, which may run through a symlink
// (a project opened via a link, or macOS's /var -> /private/var). ESLint
// compares it against the real cwd, and a mismatch reads as "outside the base
// path" -> silently ignored -> a file that looks clean because it was never
// linted. Resolve the directory (the file itself may not be saved yet).
function realFile(p) {
  try {
    return path.join(realpathSync(path.dirname(p)), path.basename(p));
  } catch {
    return p;
  }
}
let engine;

// PINNED to this unit's own config -- never looked up. ESLint 10 (and 9 under
// ESLINT_FLAGS=unstable_config_lookup_from_file) searches for a config upward
// from the FILE's directory with no cwd boundary, so a symlink inside a
// trusted unit pointing elsewhere made it load and RUN a config the user never
// trusted. Same names, same order as main's ESLINT_CONFIG_NAMES (unit.ts),
// which is also ESLint's own precedence.
const CONFIG_NAMES = ["js", "mjs", "cjs", "ts", "mts", "cts"].map(
  (e) => `eslint.config.${e}`,
);
function unitConfig() {
  for (const n of CONFIG_NAMES) {
    const p = path.join(unit, n);
    if (existsSync(p)) return p;
  }
  return null;
}

function eslint() {
  // A path, not a file: createRequire only needs a location to walk up from, so
  // a unit without its own package.json still finds a hoisted install -- the
  // same upward walk main's pre-trust "is ESLint installed" stat check does.
  engine ??= (async () => {
    const req = createRequire(path.join(unit, "__airlock_eslint__.js"));
    const mod = await import(pathToFileURL(req.resolve("eslint")).href);
    const ESLint = mod.ESLint ?? mod.default?.ESLint;
    if (!ESLint) throw new Error("This ESLint has no ESLint class (too old?)");
    const overrideConfigFile = unitConfig();
    if (!overrideConfigFile) throw new Error("This folder has no ESLint config");
    return new ESLint({ cwd: unit, overrideConfigFile });
  })();
  return engine;
}

function reply(o) {
  process.stdout.write(`${JSON.stringify(o)}\n`);
}

async function handle(line) {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return; // not a request; nothing to answer
  }
  try {
    const [res] = await (await eslint()).lintText(req.text, {
      filePath: realFile(req.filePath),
      // A file the config ignores returns no result at all, instead of ESLint's
      // "File ignored because of a matching ignore pattern" warning.
      warnIgnored: false,
    });
    reply({
      id: req.id,
      messages: (res?.messages ?? []).map((m) => ({
        line: m.line,
        column: m.column,
        endLine: m.endLine,
        endColumn: m.endColumn,
        severity: m.severity,
        ruleId: m.ruleId ?? null,
        message: m.message,
        ...(m.fix ? { fix: { range: m.fix.range, text: m.fix.text } } : {}),
      })),
    });
  } catch (err) {
    // A config that throws, or a missing plugin. Drop the engine so the next
    // request loads the config afresh -- the user is probably fixing it.
    engine = undefined;
    reply({
      id: req.id,
      configError: String(err?.message ?? err).split("\n")[0],
    });
  }
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  const lines = buf.split("\n");
  buf = lines.pop() ?? "";
  for (const line of lines) if (line.trim()) void handle(line);
});
// Main closed the pipe (pool dispose, or AirLock quit): exit rather than linger.
process.stdin.on("end", () => process.exit(0));
