import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { probePort } from "./probe";

describe("probePort", () => {
  it("detects a listening port and a closed one", async () => {
    const srv = createServer();
    const port: number = await new Promise((res) =>
      srv.listen(0, "127.0.0.1", () =>
        res((srv.address() as { port: number }).port),
      ),
    );
    expect(await probePort("127.0.0.1", port)).toBe(true);
    await new Promise<void>((r) => srv.close(() => r()));
    expect(await probePort("127.0.0.1", port, 300)).toBe(false);
  });
});
