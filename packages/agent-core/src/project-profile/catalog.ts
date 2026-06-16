import type { TechCategory } from "./types";

export interface CatalogEntry {
  id: string;
  name: string;
  category: TechCategory;
}

// Dependency (npm package name) -> entry. v1 web-stack-focused; grows freely.
export const DEP_CATALOG: Record<string, CatalogEntry> = {
  react: { id: "react", name: "React", category: "framework" },
  vue: { id: "vuedotjs", name: "Vue", category: "framework" },
  svelte: { id: "svelte", name: "Svelte", category: "framework" },
  "solid-js": { id: "solid", name: "Solid", category: "framework" },
  next: { id: "nextdotjs", name: "Next.js", category: "framework" },
  "@remix-run/react": { id: "remix", name: "Remix", category: "framework" },
  astro: { id: "astro", name: "Astro", category: "framework" },
  vite: { id: "vite", name: "Vite", category: "build" },
  electron: { id: "electron", name: "Electron", category: "framework" },
  express: { id: "express", name: "Express", category: "framework" },
  fastify: { id: "fastify", name: "Fastify", category: "framework" },
  hono: { id: "hono", name: "Hono", category: "framework" },
  tailwindcss: {
    id: "tailwindcss",
    name: "Tailwind CSS",
    category: "framework",
  },
  typescript: { id: "typescript", name: "TypeScript", category: "language" },
  "@biomejs/biome": { id: "biome", name: "Biome", category: "build" },
  eslint: { id: "eslint", name: "ESLint", category: "build" },
  prettier: { id: "prettier", name: "Prettier", category: "build" },
  vitest: { id: "vitest", name: "Vitest", category: "build" },
  jest: { id: "jest", name: "Jest", category: "build" },
  "@playwright/test": {
    id: "playwright",
    name: "Playwright",
    category: "build",
  },
  prisma: { id: "prisma", name: "Prisma", category: "orm" },
  "drizzle-orm": { id: "drizzle", name: "Drizzle", category: "orm" },
  "@neondatabase/serverless": { id: "neon", name: "Neon", category: "backend" },
  "@supabase/supabase-js": {
    id: "supabase",
    name: "Supabase",
    category: "backend",
  },
  firebase: { id: "firebase", name: "Firebase", category: "backend" },
  "@clerk/clerk-react": { id: "clerk", name: "Clerk", category: "auth" },
  "@clerk/nextjs": { id: "clerk", name: "Clerk", category: "auth" },
  "next-auth": { id: "auth0", name: "Auth.js", category: "auth" },
  stripe: { id: "stripe", name: "Stripe", category: "payments" },
  "@sentry/node": { id: "sentry", name: "Sentry", category: "observability" },
  pg: { id: "postgresql", name: "PostgreSQL", category: "database" },
};

// Config-file basename (exact match, top-level only) -> entry.
export const CONFIG_CATALOG: Record<string, CatalogEntry> = {
  "wrangler.toml": {
    id: "cloudflare",
    name: "Cloudflare",
    category: "hosting",
  },
  "vercel.json": { id: "vercel", name: "Vercel", category: "hosting" },
  "render.yaml": { id: "render", name: "Render", category: "hosting" },
  "netlify.toml": { id: "netlify", name: "Netlify", category: "hosting" },
  "fly.toml": { id: "flydotio", name: "Fly.io", category: "hosting" },
  Dockerfile: { id: "docker", name: "Docker", category: "infra" },
  "docker-compose.yml": { id: "docker", name: "Docker", category: "infra" },
  "compose.yaml": { id: "docker", name: "Docker", category: "infra" },
  "biome.json": { id: "biome", name: "Biome", category: "build" },
};

// Other (non-JS) manifest basename -> the language it implies.
export const MANIFEST_CATALOG: Record<string, CatalogEntry> = {
  "pyproject.toml": { id: "python", name: "Python", category: "language" },
  "requirements.txt": { id: "python", name: "Python", category: "language" },
  "Cargo.toml": { id: "rust", name: "Rust", category: "language" },
  "go.mod": { id: "go", name: "Go", category: "language" },
};

// Lockfile basename -> package manager entry.
export const LOCKFILE_CATALOG: Record<string, CatalogEntry> = {
  "package-lock.json": { id: "npm", name: "npm", category: "packageManager" },
  "pnpm-lock.yaml": { id: "pnpm", name: "pnpm", category: "packageManager" },
  "yarn.lock": { id: "yarn", name: "Yarn", category: "packageManager" },
  "bun.lockb": { id: "bun", name: "Bun", category: "packageManager" },
};

// High-confidence secret-NAME patterns -> service entry. Only specific patterns;
// a bare API_KEY/TOKEN/SECRET maps to nothing.
export const SECRET_CATALOG: Array<{ test: RegExp; entry: CatalogEntry }> = [
  { test: /^CLERK_/, entry: { id: "clerk", name: "Clerk", category: "auth" } },
  {
    test: /^STRIPE_/,
    entry: { id: "stripe", name: "Stripe", category: "payments" },
  },
  { test: /^NEON_/, entry: { id: "neon", name: "Neon", category: "backend" } },
  {
    test: /^SUPABASE_/,
    entry: { id: "supabase", name: "Supabase", category: "backend" },
  },
  {
    test: /^CLOUDFLARE_/,
    entry: { id: "cloudflare", name: "Cloudflare", category: "hosting" },
  },
  {
    test: /^RENDER_/,
    entry: { id: "render", name: "Render", category: "hosting" },
  },
  {
    test: /^VERCEL_/,
    entry: { id: "vercel", name: "Vercel", category: "hosting" },
  },
  {
    test: /^SENTRY_/,
    entry: { id: "sentry", name: "Sentry", category: "observability" },
  },
  {
    test: /^OPENAI_/,
    entry: { id: "openai", name: "OpenAI", category: "backend" },
  },
  {
    test: /^ANTHROPIC_/,
    entry: { id: "anthropic", name: "Anthropic", category: "backend" },
  },
  {
    test: /(^|_)DATABASE_URL$/,
    entry: { id: "postgresql", name: "PostgreSQL", category: "database" },
  },
];
