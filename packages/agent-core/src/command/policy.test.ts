import { describe, expect, it } from "vitest";
import { classifyCommand, DEFAULT_AGENT_POLICY, gateCommand } from "./policy";

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

  // H3: a privilege binary invoked BY PATH (/usr/bin/sudo, ./sudo) must still be
  // flagged -- matching only a separator-delimited basename was the bypass.
  it("flags privilege even when the binary is invoked by path (H3)", () => {
    expect(classifyCommand("/usr/bin/sudo rm x")).toContain("privilege");
    expect(classifyCommand("./sudo whoami")).toContain("privilege");
    expect(classifyCommand("/bin/su -")).toContain("privilege");
    // a mere substring is still not a match
    expect(classifyCommand("echo sudoku")).not.toContain("privilege");
  });

  // H3 class: the same path-prefix bypass defeated network + destructive.
  it("flags network/destructive binaries invoked by path", () => {
    expect(classifyCommand("/usr/bin/curl http://x")).toContain("network");
    expect(classifyCommand("/bin/rm -rf build")).toContain("destructive");
  });

  // H2: a trailing \b never matched between "~" and "/", so "~/..." and bare "~"
  // were missed (the existing ~/.ssh test passed only via the /.ssh pattern),
  // and ${HOME} was not caught. Catch the tilde token + both $HOME forms.
  it("flags tilde and $HOME paths the classifier used to miss (H2)", () => {
    expect(classifyCommand("cat ~/notes.txt")).toContain("outsideWorkspace");
    expect(classifyCommand("cd ~")).toContain("outsideWorkspace");
    expect(classifyCommand("cat $HOME/notes")).toContain("outsideWorkspace");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal shell "${HOME}", not a JS template
    expect(classifyCommand("cat ${HOME}/notes")).toContain("outsideWorkspace");
    // a "~5"-style approximation in text is not a path -> no false positive
    expect(classifyCommand('echo "approx ~5 items"')).not.toContain(
      "outsideWorkspace",
    );
    // a git ref like HEAD~1 has no token boundary before "~" -> not flagged
    expect(classifyCommand("git reset --hard HEAD~1")).not.toContain(
      "outsideWorkspace",
    );
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
