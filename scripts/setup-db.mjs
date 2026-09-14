// Creates the schema against DATABASE_URL. Optional — the app also does this
// lazily on first request — but handy for verifying a new database works.
//
//   npm run db:setup

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING;
if (!url) {
  console.error("DATABASE_URL is not set. Put it in .env.local first.");
  process.exit(1);
}

// Pull the statements straight out of lib/schema.ts so there is exactly one
// copy of the schema in the repo.
const source = readFileSync(new URL("../lib/schema.ts", import.meta.url), "utf8");
const statements = [...source.matchAll(/`([^`]*)`/g)]
  .map((m) => m[1].trim())
  .filter((s) => /^(CREATE|ALTER)\b/i.test(s));

if (statements.length === 0) {
  console.error("Could not parse any statements out of lib/schema.ts");
  process.exit(1);
}

const sql = neon(url);
for (const statement of statements) {
  const label = statement.split("\n")[0].slice(0, 68);
  await sql.query(statement);
  console.log("ok  " + label);
}
console.log(`\n${statements.length} statements applied. Database is ready.`);
