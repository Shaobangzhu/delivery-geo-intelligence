import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { MongoClient } from "mongodb";
import { z } from "zod";
import { DATABASE_NAME } from "./db.js";
import { AnnualDataError, annualInputSchema, importAnnualSummary, reconcileAnnual } from "./uberAnnualSummary.js";

let client: MongoClient | undefined;
try {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[0] !== "--file" || !args[1] || !["--dry-run", "--apply"].includes(args[2]!)) throw new Error("arguments");
  const file = resolve(args[1]);
  if ((await stat(file)).size > 64_000) throw new Error("input_size");
  const parsed = annualInputSchema().safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) throw new AnnualDataError("invalid_annual_data");
  const reconciliation = reconcileAnnual(parsed.data);
  console.info(`Year ${parsed.data.year}; sources: ${Object.entries(parsed.data.sources).filter(([, present]) => present).map(([name]) => name).join(", ")}; monthly rows: ${parsed.data.monthlyActivity.length}`);
  for (const check of reconciliation.checks) console.info(`${check.check}: ${check.status}${check.status === "mismatch" ? ` (reported ${check.reported}; expected ${check.expected}; difference ${check.difference} ${check.unit}; ${check.severity})` : ""}`);
  if (reconciliation.warnings.some((check) => check.severity === "review")) throw new AnnualDataError("financial_review_required");
  config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
  const uri = z.string().min(1).parse(process.env.MONGODB_URI);
  const target = new URL(uri);
  if (target.protocol !== "mongodb:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || (target.pathname !== "/" && target.pathname !== `/${DATABASE_NAME}`)) throw new Error("database_target");
  // Fixed local DGI database. No other collections or external providers are accessed.
  client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
  await client.connect();
  const result = await importAnnualSummary(client.db(DATABASE_NAME), parsed.data, args[2] === "--apply");
  console.info(`Result: ${result.status}; year ${result.year}. Existing operational and vehicle records preserved.`);
} catch (error) {
  const code = error instanceof AnnualDataError ? error.code : "input_or_local_database_unavailable";
  console.error(`Annual import failed: ${code}. Review the private input, arguments and local DGI connection. No overwrite performed.`);
  process.exitCode = 1;
} finally { await client?.close(); }
