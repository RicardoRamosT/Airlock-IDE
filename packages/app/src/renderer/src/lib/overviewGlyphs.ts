import type { TechCategory } from "../../../shared/ipc";

// A codicon name (no `codicon-` prefix) for a tech tile that has no bundled
// logo. Picks a glyph that signals the *kind* of tech so the tile is still
// informative. Render with `codicon codicon-${categoryGlyph(cat)}`.
export function categoryGlyph(category: TechCategory): string {
  switch (category) {
    case "language":
      return "code";
    case "runtime":
      return "server-process";
    case "framework":
      return "layers";
    case "build":
      return "tools";
    case "packageManager":
      return "package";
    case "orm":
      return "database";
    case "database":
      return "database";
    case "hosting":
      return "cloud";
    case "backend":
      return "server";
    case "auth":
      return "shield";
    case "payments":
      return "credit-card";
    case "infra":
      return "server-environment";
    case "observability":
      return "pulse";
    default:
      return "circle-large-outline";
  }
}
