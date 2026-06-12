import { describe, expect, it } from "vitest";
import {
  detectInstalledTerminals,
  KNOWN_TERMINALS,
  launchArgs,
  parseInstalled,
  terminalDisplayName,
} from "./externalTerminals";

describe("launchArgs", () => {
  it("builds open -a for the simple terminals", () => {
    expect(launchArgs("ghostty", "/repo")).toEqual({
      cmd: "open",
      args: ["-a", "Ghostty", "/repo"],
    });
    expect(launchArgs("iterm2", "/repo")).toEqual({
      cmd: "open",
      args: ["-a", "iTerm", "/repo"],
    });
  });
  it("builds the --args form for cwd-flag terminals", () => {
    expect(launchArgs("alacritty", "/repo")).toEqual({
      cmd: "open",
      args: ["-a", "Alacritty", "--args", "--working-directory", "/repo"],
    });
    expect(launchArgs("wezterm", "/repo")).toEqual({
      cmd: "open",
      args: ["-a", "WezTerm", "--args", "start", "--cwd", "/repo"],
    });
  });
  it("returns null for an unknown id", () => {
    expect(launchArgs("nope", "/repo")).toBeNull();
  });
});

describe("parseInstalled", () => {
  it("includes a terminal when mdfind returned a path, always includes Terminal.app", () => {
    const out = parseInstalled({
      ghostty: "/Applications/Ghostty.app\n",
      iterm2: "", // not installed
    });
    expect(out).toContainEqual({ id: "ghostty", name: "Ghostty" });
    expect(out).toContainEqual({ id: "terminal", name: "Terminal" }); // floor
    expect(out.find((t) => t.id === "iterm2")).toBeUndefined();
  });
});

describe("detectInstalledTerminals", () => {
  it("runs mdfind per terminal via the injected runner and maps results", async () => {
    const run = async (args: string[]) =>
      (args[0] ?? "").includes("com.mitchellh.ghostty")
        ? "/Applications/Ghostty.app\n"
        : "";
    const out = await detectInstalledTerminals(run);
    expect(out).toContainEqual({ id: "ghostty", name: "Ghostty" });
    expect(out).toContainEqual({ id: "terminal", name: "Terminal" });
  });
});

describe("terminalDisplayName", () => {
  it("maps an id to its display name, falling back to the id", () => {
    expect(terminalDisplayName("ghostty")).toBe("Ghostty");
    expect(terminalDisplayName("nope")).toBe("nope");
  });
});

it("registry has stable ids incl. terminal + ghostty", () => {
  const ids = KNOWN_TERMINALS.map((t) => t.id);
  expect(ids).toContain("terminal");
  expect(ids).toContain("ghostty");
});
