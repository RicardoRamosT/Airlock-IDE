// Eager-import every bundled logo SVG as a URL. Vite resolves `?url` at build.
// The folder may be empty (logos are added over time) -> every id falls back.
const modules = import.meta.glob("../assets/logos/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const byId = new Map<string, string>();
for (const [p, url] of Object.entries(modules)) {
  const id = p.slice(p.lastIndexOf("/") + 1, -".svg".length);
  byId.set(id, url);
}

// The bundled logo URL for a tech id, or null (caller renders a fallback glyph).
export function logoUrl(id: string): string | null {
  return byId.get(id) ?? null;
}
