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
      "vercel",
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

  it("leaves Vercel contributing to no category section", () => {
    // Vercel keeps feeding the Activity feed; it has no standing resource that
    // belongs in Databases or Host.
    expect(sectionExtension("vercel")?.contributesTo).toBeUndefined();
  });

  it("returns null for an unknown id rather than throwing", () => {
    expect(sectionExtension("nope")).toBeNull();
  });
});
