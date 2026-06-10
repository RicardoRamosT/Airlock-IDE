import { describe, expect, it } from "vitest";
import { fileIconFor } from "./fileIcons";

describe("fileIconFor", () => {
  it("maps TypeScript/JavaScript to text badges", () => {
    expect(fileIconFor("store.ts")).toEqual({
      kind: "badge",
      text: "TS",
      color: "var(--ficon-ts)",
    });
    expect(fileIconFor("index.js")).toMatchObject({ text: "JS" });
  });

  it("exact names beat extensions", () => {
    expect(fileIconFor("package.json")).toMatchObject({
      icon: "json",
      color: "var(--ficon-pkg)",
    });
    expect(fileIconFor("data.json")).toMatchObject({
      icon: "json",
      color: "var(--ficon-json)",
    });
    expect(fileIconFor("CLAUDE.md")).toMatchObject({ icon: "sparkle" });
    expect(fileIconFor("notes.md")).toMatchObject({ icon: "markdown" });
  });

  it("compound suffixes beat extensions", () => {
    expect(fileIconFor("quota.test.ts")).toMatchObject({ icon: "beaker" });
    expect(fileIconFor("parse.spec.js")).toMatchObject({ icon: "beaker" });
    expect(fileIconFor("vite.config.ts")).toMatchObject({ icon: "gear" });
  });

  it("is case-insensitive", () => {
    expect(fileIconFor("README.MD")).toMatchObject({ icon: "markdown" });
    expect(fileIconFor("Dockerfile")).toMatchObject({ icon: "vm" });
  });

  it("locks .env and its variants", () => {
    expect(fileIconFor(".env")).toMatchObject({ icon: "lock" });
    expect(fileIconFor(".env.local")).toMatchObject({ icon: "lock" });
    expect(fileIconFor(".environment")).toEqual({
      kind: "codicon",
      icon: "file",
    });
  });

  it("falls back to the generic file icon", () => {
    expect(fileIconFor("LICENSE")).toEqual({ kind: "codicon", icon: "file" });
    expect(fileIconFor("weird.xyz")).toEqual({ kind: "codicon", icon: "file" });
  });
});
