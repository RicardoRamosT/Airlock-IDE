import { expect, it } from "vitest";
import { dotEnvKeys } from "./dotenv";

it("reads key names and never a value", () => {
  const keys = dotEnvKeys(
    [
      "# comment",
      "AZURE_STORAGE_KEY=super-secret-value",
      "export AZURE_CLIENT_ID = another-secret",
      "  SPACED=1",
      "NOT_AN_ASSIGNMENT",
      "",
    ].join("\n"),
  );
  expect(keys).toEqual(["AZURE_STORAGE_KEY", "AZURE_CLIENT_ID", "SPACED"]);
  // The point of the function: nothing it returns can contain a value.
  expect(keys.join("")).not.toContain("secret");
});

it("dedupes and ignores comments and blanks", () => {
  expect(dotEnvKeys("A=1\n\n#A=2\nA=3\n")).toEqual(["A"]);
});

it("is empty for a file with no assignments", () => {
  expect(dotEnvKeys("# just a note\n\n")).toEqual([]);
});
