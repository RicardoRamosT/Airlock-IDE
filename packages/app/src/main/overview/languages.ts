// Pure: map file extensions to languages and summarize a file list into a
// language breakdown for the Overview "Stats" card. No I/O here -- gather.ts
// does the (bounded) directory walk and passes the file names in.

const EXT_TO_LANG: Record<string, { id: string; name: string }> = {
  ts: { id: "typescript", name: "TypeScript" },
  tsx: { id: "typescript", name: "TypeScript" },
  mts: { id: "typescript", name: "TypeScript" },
  cts: { id: "typescript", name: "TypeScript" },
  js: { id: "javascript", name: "JavaScript" },
  jsx: { id: "javascript", name: "JavaScript" },
  mjs: { id: "javascript", name: "JavaScript" },
  cjs: { id: "javascript", name: "JavaScript" },
  py: { id: "python", name: "Python" },
  rs: { id: "rust", name: "Rust" },
  go: { id: "go", name: "Go" },
  java: { id: "java", name: "Java" },
  kt: { id: "kotlin", name: "Kotlin" },
  rb: { id: "ruby", name: "Ruby" },
  php: { id: "php", name: "PHP" },
  cs: { id: "csharp", name: "C#" },
  c: { id: "c", name: "C" },
  h: { id: "c", name: "C" },
  cpp: { id: "cpp", name: "C++" },
  cc: { id: "cpp", name: "C++" },
  hpp: { id: "cpp", name: "C++" },
  swift: { id: "swift", name: "Swift" },
  css: { id: "css", name: "CSS" },
  scss: { id: "css", name: "CSS" },
  sass: { id: "css", name: "CSS" },
  less: { id: "css", name: "CSS" },
  html: { id: "html", name: "HTML" },
  vue: { id: "vue", name: "Vue" },
  svelte: { id: "svelte", name: "Svelte" },
  json: { id: "json", name: "JSON" },
  md: { id: "markdown", name: "Markdown" },
  mdx: { id: "markdown", name: "Markdown" },
  sh: { id: "shell", name: "Shell" },
  bash: { id: "shell", name: "Shell" },
  zsh: { id: "shell", name: "Shell" },
  sql: { id: "sql", name: "SQL" },
  yml: { id: "yaml", name: "YAML" },
  yaml: { id: "yaml", name: "YAML" },
  toml: { id: "toml", name: "TOML" },
};

export interface LanguageStat {
  id: string;
  name: string;
  files: number;
}

// Summarize file names into a language breakdown, sorted by file count desc.
// The top `topN` languages are kept; everything else (extra languages +
// unrecognized extensions) folds into a single "Other" bucket appended last.
export function languageBreakdown(
  names: string[],
  topN = 6,
): LanguageStat[] {
  const counts = new Map<string, { name: string; files: number }>();
  let other = 0;
  for (const n of names) {
    const dot = n.lastIndexOf(".");
    const ext = dot > 0 ? n.slice(dot + 1).toLowerCase() : "";
    const lang = ext ? EXT_TO_LANG[ext] : undefined;
    if (!lang) {
      other += 1;
      continue;
    }
    const cur = counts.get(lang.id) ?? { name: lang.name, files: 0 };
    cur.files += 1;
    counts.set(lang.id, cur);
  }
  const sorted = [...counts.entries()]
    .map(([id, v]) => ({ id, name: v.name, files: v.files }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
  const top = sorted.slice(0, topN);
  const rest = sorted.slice(topN).reduce((s, l) => s + l.files, 0) + other;
  if (rest > 0) top.push({ id: "other", name: "Other", files: rest });
  return top;
}
