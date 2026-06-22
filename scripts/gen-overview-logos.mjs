// scripts/gen-overview-logos.mjs
// Dev-only: regenerate bundled tech logos from simple-icons. The catalog `id`
// in packages/agent-core/src/project-profile/catalog.ts IS the simple-icons
// slug, so we name each SVG <slug>.svg and overviewLogos.ts globs it.
// Run from repo root: `node scripts/gen-overview-logos.mjs`
import { mkdirSync, writeFileSync } from "node:fs";
import * as si from "simple-icons";

// Every id emitted by DEP_CATALOG + FILE_CATALOG (keep in sync as the catalog grows).
const SLUGS = [
  "anthropic", "astro", "auth0", "biome", "bun", "clerk", "cloudflare",
  "docker", "drizzle", "electron", "eslint", "express", "fastify", "firebase",
  "flydotio", "go", "hono", "jest", "neon", "netlify", "nextdotjs", "npm",
  "openai", "playwright", "pnpm", "postgresql", "prettier", "prisma", "python",
  "react", "remix", "render", "rust", "sentry", "solid", "stripe", "supabase",
  "svelte", "tailwindcss", "typescript", "vercel", "vite", "vitest",
  "vuedotjs", "yarn",
];
const FILL = "#c9ccd6"; // light neutral — visible on the dark IDE theme
const OUT = "packages/app/src/renderer/src/assets/logos";

const bySlug = {};
for (const icon of Object.values(si)) {
  if (icon && typeof icon === "object" && "slug" in icon && "path" in icon) {
    bySlug[icon.slug] = icon;
  }
}

mkdirSync(OUT, { recursive: true });
let made = 0;
const missing = [];
for (const slug of SLUGS) {
  const icon = bySlug[slug];
  if (!icon) {
    missing.push(slug);
    continue;
  }
  const svg = `<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="${FILL}" d="${icon.path}"/></svg>\n`;
  writeFileSync(`${OUT}/${slug}.svg`, svg);
  made += 1;
}
console.log(`Generated ${made} logos. Missing (fall back to category glyph): ${missing.join(", ") || "none"}`);
