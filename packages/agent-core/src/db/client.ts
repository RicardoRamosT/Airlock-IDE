import pg from "pg";
import type { DbRunner, QueryResult } from "./explorer";

/**
 * A short-lived pg connection bound to one connection string, exposing the
 * DbRunner interface. Cloud Postgres (Neon etc.) requires SSL; we enable it
 * with rejectUnauthorized:false when the URL asks for sslmode (pragmatic for
 * v1 -- avoids CA wrangling; revisit if strict cert checking is wanted).
 * Connect + query are time-bounded so an unreachable DB never hangs the UI.
 */
export async function withDb<T>(
  connectionString: string,
  fn: (run: DbRunner) => Promise<T>,
): Promise<T> {
  const ssl = /sslmode=require|neon\.tech|\.aws\./.test(connectionString)
    ? { rejectUnauthorized: false }
    : undefined;
  const client = new pg.Client({
    connectionString,
    ssl,
    connectionTimeoutMillis: 5000,
    statement_timeout: 8000,
    query_timeout: 8000,
  });
  await client.connect();
  try {
    const run: DbRunner = {
      async query(sql, params): Promise<QueryResult> {
        const res = await client.query({
          text: sql,
          values: params,
          rowMode: "array",
        });
        return {
          columns: res.fields.map((f) => f.name),
          rows: res.rows as unknown[][],
        };
      },
    };
    return await fn(run);
  } finally {
    await client.end().catch(() => {});
  }
}
