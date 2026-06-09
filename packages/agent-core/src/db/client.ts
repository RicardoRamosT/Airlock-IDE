import pg from "pg";
import type { DbRunner, QueryResult } from "./explorer";

/**
 * A short-lived pg connection bound to one connection string, exposing the
 * DbRunner interface. Cloud Postgres (Neon etc.) requires SSL; we enable it WITH
 * certificate validation (rejectUnauthorized:true). The previous
 * rejectUnauthorized:false accepted ANY certificate -- including a forged one --
 * so the TLS gave encryption but no authentication, leaving the connection open
 * to a silent MITM that captures the credentials and all query data (audit L5).
 * Neon/Supabase/most managed Postgres present publicly-trusted certs (covered by
 * Node's bundled CA store), so validation works without configuration; a server
 * behind a private CA would need an explicit CA bundle (a future setting) rather
 * than silently disabling validation.
 * Connect + query are time-bounded so an unreachable DB never hangs the UI.
 */
export async function withDb<T>(
  connectionString: string,
  fn: (run: DbRunner) => Promise<T>,
): Promise<T> {
  const ssl = /sslmode=require|sslmode=verify|neon\.tech|\.aws\./.test(
    connectionString,
  )
    ? { rejectUnauthorized: true }
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
