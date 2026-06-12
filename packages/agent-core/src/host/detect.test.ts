import { describe, expect, it } from "vitest";
import { COMMON_DEV_PORTS, guessDevPort, pickListeningPort } from "./detect";
import type { PortProber } from "./probe";

describe("guessDevPort", () => {
  it("prefers an explicit --port flag in any script", () => {
    expect(
      guessDevPort(
        JSON.stringify({
          scripts: { dev: "vite --port 4000" },
          devDependencies: { vite: "^5" },
        }),
      ),
    ).toBe(4000);
    expect(
      guessDevPort(
        JSON.stringify({ scripts: { start: "next dev --port=3100" } }),
      ),
    ).toBe(3100);
  });

  it("falls back to the framework default by dependency", () => {
    expect(
      guessDevPort(JSON.stringify({ devDependencies: { vite: "^5" } })),
    ).toBe(5173);
    expect(
      guessDevPort(
        JSON.stringify({ devDependencies: { "@vitejs/plugin-react": "^4" } }),
      ),
    ).toBe(5173);
    expect(guessDevPort(JSON.stringify({ dependencies: { next: "14" } }))).toBe(
      3000,
    );
    expect(
      guessDevPort(JSON.stringify({ dependencies: { "react-scripts": "5" } })),
    ).toBe(3000);
    expect(
      guessDevPort(JSON.stringify({ dependencies: { astro: "^4" } })),
    ).toBe(4321);
  });

  it("returns null for an unrecognized framework or bad json", () => {
    expect(
      guessDevPort(JSON.stringify({ dependencies: { express: "^4" } })),
    ).toBeNull();
    expect(guessDevPort("not json")).toBeNull();
  });
});

describe("pickListeningPort", () => {
  const proberFor =
    (...up: number[]): PortProber =>
    (_host, port) =>
      Promise.resolve(up.includes(port));

  it("prefers a guessed port that is listening over a listening common port", async () => {
    // 5173 (guessed) and 3000 (common) both up -> the guess wins.
    expect(await pickListeningPort([5173], proberFor(5173, 3000), [3000])).toBe(
      5173,
    );
  });

  it("falls back to a listening common port when no guess is up", async () => {
    // guessed 9999 is down; common 5200 is up.
    expect(await pickListeningPort([9999], proberFor(5200), [3000, 5200])).toBe(
      5200,
    );
  });

  it("returns the highest-priority listening port among common ports", async () => {
    // both 3000 and 8080 up -> 3000 (earlier in the list) wins.
    expect(
      await pickListeningPort([], proberFor(3000, 8080), [3000, 8080]),
    ).toBe(3000);
  });

  it("returns null when nothing is listening", async () => {
    expect(await pickListeningPort([5173], proberFor(), [3000])).toBeNull();
  });

  it("ships a non-empty default common-port list including 5173", () => {
    expect(COMMON_DEV_PORTS).toContain(5173);
    expect(COMMON_DEV_PORTS.length).toBeGreaterThan(3);
  });
});
