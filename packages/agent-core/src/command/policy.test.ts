import { describe, expect, it } from "vitest";
import {
  classifyCommand,
  DEFAULT_AGENT_POLICY,
  gateCommand,
} from "./policy";

describe("classifyCommand", () => {
  it("flags privilege escalation", () => {
    expect(classifyCommand("sudo rm x")).toContain("privilege");
    expect(classifyCommand("doas whoami")).toContain("privilege");
  });
  it("flags network tools", () => {
    expect(classifyCommand("curl http://x")).toContain("network");
    expect(classifyCommand("wget x")).toContain("network");
  });
  it("flags destructive commands", () => {
    expect(classifyCommand("rm -rf build")).toContain("destructive");
    expect(classifyCommand("git push --force")).toContain("destructive");
    expect(classifyCommand("git reset --hard HEAD~1")).toContain("destructive");
  });
  it("flags access outside the workspace", () => {
    expect(classifyCommand("cat ~/.ssh/id_rsa")).toContain("outsideWorkspace");
    expect(classifyCommand("cat ../../secret")).toContain("outsideWorkspace");
  });
  it("flags nothing for safe in-project commands", () => {
    expect(classifyCommand("npm test")).toEqual([]);
    expect(classifyCommand("git status")).toEqual([]);
    expect(classifyCommand("ls src")).toEqual([]);
  });
});

describe("gateCommand", () => {
  const P = DEFAULT_AGENT_POLICY; // network:allow, outside:ask, destructive:ask, privilege:block

  it("runs safe commands", () => {
    expect(gateCommand("npm test", P, false)).toEqual({ run: true });
  });
  it("allows network by default", () => {
    expect(gateCommand("curl http://x", P, false)).toEqual({ run: true });
  });
  it("asks for destructive without confirm, runs with confirm", () => {
    const blocked = gateCommand("rm -rf build", P, false);
    expect(blocked.run).toBe(false);
    if (blocked.run === false) {
      expect(blocked.action).toBe("ask");
      expect(blocked.categories).toContain("destructive");
      expect(blocked.reason).toMatch(/destructive/i);
    }
    expect(gateCommand("rm -rf build", P, true)).toEqual({ run: true });
  });
  it("blocks privilege absolutely -- confirm does NOT override", () => {
    expect(gateCommand("sudo rm x", P, true).run).toBe(false);
  });
  it("takes the strictest action across categories", () => {
    // sudo (block) + curl (allow) -> block
    expect(gateCommand("sudo curl http://x", P, true).run).toBe(false);
  });
});
