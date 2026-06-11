import { describe, expect, it } from "vitest";
import { isImportableEnvFile, sortEnvFiles } from "./envFiles";

describe("isImportableEnvFile", () => {
  it("accepts .env and .env.* variants", () => {
    expect(isImportableEnvFile(".env")).toBe(true);
    expect(isImportableEnvFile(".env.local")).toBe(true);
    expect(isImportableEnvFile(".env.development")).toBe(true);
    expect(isImportableEnvFile(".env.development.local")).toBe(true);
  });

  it("rejects template/encrypted conventions", () => {
    expect(isImportableEnvFile(".env.example")).toBe(false);
    expect(isImportableEnvFile(".env.local.example")).toBe(false);
    expect(isImportableEnvFile(".env.sample")).toBe(false);
    expect(isImportableEnvFile(".env.template")).toBe(false);
    expect(isImportableEnvFile(".env.dist")).toBe(false);
    expect(isImportableEnvFile(".env.vault")).toBe(false);
  });

  it("rejects names that merely resemble env files", () => {
    expect(isImportableEnvFile("env")).toBe(false);
    expect(isImportableEnvFile(".envrc")).toBe(false);
    expect(isImportableEnvFile(".environment")).toBe(false);
    expect(isImportableEnvFile("config.env")).toBe(false);
  });
});

describe("sortEnvFiles", () => {
  it("orders .env first, then non-local, then .local files (last write wins)", () => {
    expect(
      sortEnvFiles([
        ".env.local",
        ".env.production",
        ".env",
        ".env.development.local",
        ".env.development",
      ]),
    ).toEqual([
      ".env",
      ".env.development",
      ".env.production",
      ".env.development.local",
      ".env.local",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [".env.local", ".env"];
    sortEnvFiles(input);
    expect(input).toEqual([".env.local", ".env"]);
  });
});
