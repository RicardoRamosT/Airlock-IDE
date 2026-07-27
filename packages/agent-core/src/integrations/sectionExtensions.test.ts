import { describe, expect, it } from "vitest";
import {
  providersFor,
  SECTION_EXTENSIONS,
  sectionExtension,
} from "./sectionExtensions";

describe("SECTION_EXTENSIONS", () => {
  it("covers every service the rule reclassifies", () => {
    expect(SECTION_EXTENSIONS.map((d) => d.id).sort()).toEqual([
      "azure",
      "docker",
      "neon",
      "render",
      "snowflake",
    ]);
  });

  it("gives every descriptor a brand icon and a description", () => {
    for (const d of SECTION_EXTENSIONS) {
      expect(d.icon, d.id).toBe(d.id); // brand glyph id == extension id
      expect(d.name.length, d.id).toBeGreaterThan(0);
      expect(d.description.length, d.id).toBeGreaterThan(0);
    }
  });

  it("routes database providers to Databases and host providers to Host", () => {
    expect(providersFor("databases").map((d) => d.id)).toEqual([
      "neon",
      "docker",
      "snowflake",
    ]);
    expect(providersFor("host").map((d) => d.id)).toEqual(["render", "azure"]);
  });

  it("returns null for a service that was removed", () => {
    // Vercel was a pilot integration that proved the manifest engine and was
    // deleted once it had; nothing should resolve it any more.
    expect(sectionExtension("vercel")).toBeNull();
  });

  it("returns null for an unknown id rather than throwing", () => {
    expect(sectionExtension("nope")).toBeNull();
  });
});
