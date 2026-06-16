export type TechCategory =
  | "language"
  | "runtime"
  | "framework"
  | "build"
  | "packageManager"
  | "orm"
  | "database"
  | "hosting"
  | "backend"
  | "auth"
  | "payments"
  | "infra"
  | "observability"
  | "other";

// Categories that render under "Services" (vs "Technologies").
export const SERVICE_CATEGORIES: ReadonlySet<TechCategory> =
  new Set<TechCategory>([
    "database",
    "hosting",
    "backend",
    "auth",
    "payments",
    "infra",
    "observability",
  ]);

export interface ProjectTech {
  id: string; // stable; equals the logo key where a logo exists ("react", "neon")
  name: string; // display name ("React", "Neon")
  category: TechCategory;
  version?: string; // from the manifest, when known
  sources: string[]; // human labels, e.g. "package.json", "wrangler.toml", "secret: CLERK_SECRET_KEY"
}

export interface ProjectArea {
  name: string; // "agent-core", "app/main"
  path: string; // workspace-relative dir
}

export interface ProjectProfile {
  root: string;
  techs: ProjectTech[]; // non-service categories
  services: ProjectTech[]; // SERVICE_CATEGORIES
  areas: ProjectArea[]; // seed skeleton; prose lives in .airlock/overview.md
  generatedAt: number; // epoch ms
}
