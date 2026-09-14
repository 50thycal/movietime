import { neon } from "@neondatabase/serverless";
import { SCHEMA_STATEMENTS } from "./schema";

/**
 * The minimal surface we use from the Neon driver: a tagged template that
 * returns rows, plus `.query(text, params)` for the schema statements.
 * Tests swap in a PGlite-backed implementation with the same shape.
 */
export interface Sql {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (strings: TemplateStringsArray, ...values: any[]): Promise<Record<string, any>[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(text: string, params?: any[]): Promise<Record<string, any>[]>;
}

let client: Sql | null = null;
let override: Sql | null = null;

/**
 * Postgres drivers hand back `Date` objects for timestamptz and date columns,
 * but every type in lib/types.ts declares those fields as ISO strings — which
 * is what they become the moment a row is serialised into an API response.
 * Server-side code that runs *before* that serialisation (the stats engine,
 * say) would otherwise see Dates and quietly break on string operations.
 * Normalising here means there is one shape, everywhere, matching the types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeRows(rows: Record<string, any>[]): Record<string, any>[] {
  for (const row of rows) {
    for (const key in row) {
      if (row[key] instanceof Date) row[key] = (row[key] as Date).toISOString();
    }
  }
  return rows;
}

/** Wraps a driver so every row it returns has ISO-string timestamps. */
function normalized(inner: Sql): Sql {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = async (text: string, params?: any[]) => normalizeRows(await inner.query(text, params));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql = (async (strings: TemplateStringsArray, ...values: any[]) => normalizeRows(await inner(strings, ...values))) as Sql;
  sql.query = query;
  return sql;
}

/**
 * Vercel injects a different variable name depending on how the database was
 * attached — the Neon marketplace integration sets DATABASE_URL, while the
 * older Vercel Postgres path sets POSTGRES_URL. Accept either, and fall back to
 * the direct (unpooled) URLs so the app still comes up if only those are
 * present. Pooled first: these are serverless functions.
 */
const URL_VARS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "DATABASE_URL_UNPOOLED",
  "POSTGRES_URL_NON_POOLING",
] as const;

function connect(): Sql {
  if (override) return override;
  if (client) return client;
  const name = URL_VARS.find((key) => process.env[key]);
  if (!name && process.env.MOVIETIME_LOCAL_DB === "pglite") {
    client = normalized(localPglite());
    return client;
  }
  if (!name) {
    throw new Error(
      "No database URL is set. Add a Postgres database to the project " +
        "(Vercel → Storage → Create Database → Neon), then redeploy so the " +
        "connection string reaches this deployment. Locally, copy " +
        ".env.example to .env.local. Looked for: " +
        URL_VARS.join(", ") +
        ".",
    );
  }
  client = normalized(neon(process.env[name]!) as unknown as Sql);
  return client;
}

/**
 * Local development without a Neon account: `MOVIETIME_LOCAL_DB=pglite npm run dev`
 * runs an embedded Postgres (PGlite, a devDependency) with data kept in
 * `.pglite/`. Never used when a real database URL is present, and the
 * dynamic import keeps it out of the production bundle.
 */
function localPglite(): Sql {
  const ready = (async () => {
    const spec = "@electric-sql/pglite";
    const { PGlite } = (await import(/* webpackIgnore: true */ spec)) as typeof import("@electric-sql/pglite");
    const pg = new PGlite(process.env.MOVIETIME_LOCAL_DB_DIR ?? "./.pglite");
    await pg.waitReady;
    return pg;
  })();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = async (text: string, params: any[] = []) => (await (await ready).query(text, params)).rows as Record<string, any>[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql = (async (strings: TemplateStringsArray, ...values: any[]) =>
    query(
      strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""), ""),
      values,
    )) as Sql;
  sql.query = query;
  return sql;
}

let ready: Promise<void> | null = null;

/** Creates the schema if it isn't there yet. Runs at most once per warm instance. */
function ensureSchema(c: Sql) {
  if (!ready) {
    ready = (async () => {
      for (const statement of SCHEMA_STATEMENTS) {
        await c.query(statement);
      }
    })().catch((err) => {
      ready = null; // let the next request retry
      throw err;
    });
  }
  return ready;
}

/**
 * `sql` tagged template, with the schema guaranteed to exist.
 *
 *   const rows = await (await db())`SELECT * FROM members`;
 */
export async function db(): Promise<Sql> {
  const c = connect();
  await ensureSchema(c);
  return c;
}

/** Test hook: point every route at an in-process database. */
export function setDbForTests(sql: Sql | null) {
  override = sql ? normalized(sql) : null;
  ready = null;
}

export { SCHEMA_STATEMENTS };
