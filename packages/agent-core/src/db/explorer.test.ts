import { describe, expect, it, vi } from "vitest";
import { type DbRunner, listTables, pingDb, readRows } from "./explorer";

function fake(result: {
  columns: string[];
  rows: unknown[][];
}): DbRunner & { calls: { sql: string; params?: unknown[] }[] } {
  const calls: { sql: string; params?: unknown[] }[] = [];
  return {
    calls,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return result;
    }),
  };
}

describe("explorer", () => {
  it("ping runs SELECT 1", async () => {
    const r = fake({ columns: [], rows: [] });
    await pingDb(r);
    expect(r.calls[0]?.sql).toBe("SELECT 1");
  });

  it("listTables filters system schemas and maps rows", async () => {
    const r = fake({
      columns: ["table_schema", "table_name"],
      rows: [
        ["public", "users"],
        ["app", "orders"],
      ],
    });
    expect(await listTables(r)).toEqual([
      { schema: "public", name: "users" },
      { schema: "app", name: "orders" },
    ]);
    expect(r.calls[0]?.sql).toContain("information_schema.tables");
    expect(r.calls[0]?.sql).toContain(
      "NOT IN ('pg_catalog', 'information_schema')",
    );
  });

  it("readRows quotes identifiers and clamps the limit", async () => {
    const r = fake({ columns: ["id"], rows: [[1]] });
    await readRows(r, "public", "users", 50);
    expect(r.calls[0]?.sql).toBe('SELECT * FROM "public"."users" LIMIT 50');
    await readRows(r, "public", "users", 99999);
    expect(r.calls[1]?.sql).toBe('SELECT * FROM "public"."users" LIMIT 1000');
    await readRows(r, "public", "users", -5);
    expect(r.calls[2]?.sql).toBe('SELECT * FROM "public"."users" LIMIT 100');
  });

  it("escapes embedded quotes in identifiers (injection defense)", async () => {
    const r = fake({ columns: [], rows: [] });
    await readRows(r, 'pu"blic', 'us"ers', 10);
    expect(r.calls[0]?.sql).toBe('SELECT * FROM "pu""blic"."us""ers" LIMIT 10');
  });
});
