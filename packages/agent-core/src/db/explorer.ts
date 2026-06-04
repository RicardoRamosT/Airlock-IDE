export interface QueryResult {
  columns: string[];
  rows: unknown[][];
}
export interface DbRunner {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
}

export interface DbTable {
  schema: string;
  name: string;
}

// Double-quote an identifier and escape embedded quotes (defense in depth even
// though schema/table come from the DB's own catalog).
function quoteIdent(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

export async function pingDb(run: DbRunner): Promise<void> {
  await run.query("SELECT 1");
}

export async function listTables(run: DbRunner): Promise<DbTable[]> {
  const res = await run.query(
    "SELECT table_schema, table_name FROM information_schema.tables " +
      "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') " +
      "ORDER BY table_schema, table_name",
  );
  return res.rows.map((r) => ({ schema: String(r[0]), name: String(r[1]) }));
}

export async function readRows(
  run: DbRunner,
  schema: string,
  table: string,
  limit: number,
): Promise<QueryResult> {
  const lim =
    Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), 1000)
      : 100;
  // Identifiers are quoted (cannot be parameters in SQL); limit is a clamped int.
  const sql = `SELECT * FROM ${quoteIdent(schema)}.${quoteIdent(table)} LIMIT ${lim}`;
  return run.query(sql);
}
