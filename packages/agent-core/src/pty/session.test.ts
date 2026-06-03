import { describe, expect, it } from "vitest";
import { createPtySession, type PtySession } from "./session";

function collectUntilExit(
  s: PtySession,
): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    let output = "";
    s.onData((d) => {
      output += d;
    });
    s.onExit((exitCode) => resolve({ output, exitCode }));
  });
}

describe("PtySession", () => {
  it("runs a command and captures its output", async () => {
    const s = createPtySession({
      shell: "/bin/zsh",
      args: ["-c", "printf MARKER123"],
    });
    const { output, exitCode } = await collectUntilExit(s);
    expect(output).toContain("MARKER123");
    expect(exitCode).toBe(0);
  }, 10_000);

  it("accepts written input in an interactive shell", async () => {
    const s = createPtySession({ shell: "/bin/zsh" });
    const done = collectUntilExit(s);
    s.write("printf INTERACTIVE_OK\r");
    s.write("exit\r");
    const { output } = await done;
    expect(output).toContain("INTERACTIVE_OK");
  }, 10_000);

  it("resizes without throwing", () => {
    const s = createPtySession({ shell: "/bin/zsh" });
    expect(() => s.resize(120, 40)).not.toThrow();
    s.kill();
  });

  it("gives each session a unique id", () => {
    const a = createPtySession({ shell: "/bin/zsh" });
    const b = createPtySession({ shell: "/bin/zsh" });
    expect(a.id).not.toBe(b.id);
    a.kill();
    b.kill();
  });
});
