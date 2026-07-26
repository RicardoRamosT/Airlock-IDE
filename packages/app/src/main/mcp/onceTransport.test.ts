import { describe, expect, it } from "vitest";
import { encodeJson, expectedReplies, OnceTransport } from "./onceTransport";

describe("encodeJson", () => {
  it("encodes ASCII exactly", () => {
    const buf = encodeJson({ a: 1 });
    expect(buf.toString("utf8")).toBe('{"a":1}');
    expect(buf.length).toBe(7);
  });

  it("encodes multi-byte text without losing bytes", () => {
    // The bug this guards: Electron's UTF-8 encoder returned a byte length
    // SMALLER than the character count for strings of this shape, truncating
    // the body. Assert the round-trip, which is what the guard checks at runtime.
    const value = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: `${"ñ".repeat(3)}${"a".repeat(40)}` }],
      },
    };
    const json = JSON.stringify(value);
    const buf = encodeJson(value);
    expect(buf.toString("utf8")).toBe(json);
    // Every byte accounted for: 3 n-tildes contribute one extra byte each.
    expect(buf.length).toBe(json.length + 3);
  });

  it("encodes emoji (4-byte, surrogate pair) correctly", () => {
    const buf = encodeJson({ text: "🫣 ok" });
    expect(buf.toString("utf8")).toBe('{"text":"🫣 ok"}');
  });

  it("round-trips a long mixed payload", () => {
    const text = `${"Treviño ".repeat(50)}${"🙂".repeat(20)}`;
    const buf = encodeJson({ text });
    expect(JSON.parse(buf.toString("utf8")).text).toBe(text);
  });
});

describe("expectedReplies", () => {
  it("counts one for a single request", () => {
    expect(
      expectedReplies({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    ).toBe(1);
  });

  it("counts ZERO for a notification (no id, so no reply is coming)", () => {
    expect(
      expectedReplies({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ).toBe(0);
  });

  it("counts each request in a batch", () => {
    expect(
      expectedReplies([
        { jsonrpc: "2.0", id: 1, method: "tools/list" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "ping" },
      ]),
    ).toBe(2);
  });

  it("counts zero for junk rather than hanging forever", () => {
    expect(expectedReplies(null)).toBe(0);
    expect(expectedReplies("nope")).toBe(0);
    expect(expectedReplies([])).toBe(0);
  });

  it("treats id 0 and null id as a request / not a request", () => {
    expect(expectedReplies({ jsonrpc: "2.0", id: 0, method: "ping" })).toBe(1);
    expect(expectedReplies({ jsonrpc: "2.0", id: null, method: "ping" })).toBe(
      0,
    );
  });
});

describe("OnceTransport", () => {
  it("delivers the request and resolves with the server's reply", async () => {
    const t = new OnceTransport();
    await t.start();
    // Stand in for the McpServer: reply to whatever arrives.
    t.onmessage = (m) => {
      void t.send({
        jsonrpc: "2.0",
        id: (m as { id: number }).id,
        result: { ok: true },
      });
    };
    const replies = await t.handle({ jsonrpc: "2.0", id: 7, method: "ping" });
    expect(replies).toEqual([{ jsonrpc: "2.0", id: 7, result: { ok: true } }]);
  });

  it("resolves immediately for a notification (nothing to wait for)", async () => {
    const t = new OnceTransport();
    await t.start();
    t.onmessage = () => {};
    await expect(
      t.handle({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ).resolves.toEqual([]);
  });

  it("waits for every reply in a batch", async () => {
    const t = new OnceTransport();
    await t.start();
    t.onmessage = (m) => {
      const id = (m as { id?: number }).id;
      if (id !== undefined) void t.send({ jsonrpc: "2.0", id, result: {} });
    };
    const replies = await t.handle([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ]);
    expect(replies.map((r) => (r as { id: number }).id)).toEqual([1, 2]);
  });

  it("reports onclose when closed", async () => {
    const t = new OnceTransport();
    let closed = false;
    t.onclose = () => {
      closed = true;
    };
    await t.start();
    await t.close();
    expect(closed).toBe(true);
  });

  it("resolves (rather than hanging) if the server never replies", async () => {
    const t = new OnceTransport();
    await t.start();
    t.onmessage = () => {}; // never sends
    await expect(
      t.handle({ jsonrpc: "2.0", id: 1, method: "ping" }, 20),
    ).resolves.toEqual([]);
  });
});
