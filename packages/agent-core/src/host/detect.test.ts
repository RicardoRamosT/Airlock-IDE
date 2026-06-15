import { describe, expect, it } from "vitest";
import {
  COMMON_DEV_PORTS,
  excludeReservedPorts,
  guessDevPort,
  MACOS_RESERVED_PORTS,
  pickListeningPort,
} from "./detect";
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

  it("does not surface a reserved macOS port even when it is the only listener", async () => {
    // The reported bug: the user's dev server is stopped, but macOS Control
    // Center / AirPlay Receiver squats :5000, so a blind TCP scan finds the OS
    // and reports http://localhost:5000 as a live host. After excluding the
    // reserved ports on darwin, nothing is up -> null (no phantom dev server).
    const common = excludeReservedPorts(COMMON_DEV_PORTS, "darwin");
    expect(await pickListeningPort([], proberFor(5000), common)).toBeNull();
  });

  it("ships a non-empty default common-port list including 5173", () => {
    expect(COMMON_DEV_PORTS).toContain(5173);
    expect(COMMON_DEV_PORTS.length).toBeGreaterThan(3);
  });
});

describe("excludeReservedPorts", () => {
  it("drops the macOS AirPlay ports (5000/7000) on darwin, preserving order", () => {
    expect(excludeReservedPorts([5173, 5000, 3000, 7000], "darwin")).toEqual([
      5173, 3000,
    ]);
  });

  it("keeps every port on non-darwin platforms (5000 is a real dev port there)", () => {
    expect(excludeReservedPorts([5173, 5000, 7000], "linux")).toEqual([
      5173, 5000, 7000,
    ]);
    expect(excludeReservedPorts([5000], "win32")).toEqual([5000]);
  });

  it("strips 5000 from the default common-port list on darwin", () => {
    expect(COMMON_DEV_PORTS).toContain(5000); // raw list still has it...
    expect(excludeReservedPorts(COMMON_DEV_PORTS, "darwin")).not.toContain(
      5000,
    );
  });

  it("MACOS_RESERVED_PORTS covers the AirPlay Receiver ports", () => {
    expect(MACOS_RESERVED_PORTS).toContain(5000);
    expect(MACOS_RESERVED_PORTS).toContain(7000);
  });
});
