import { readFile } from "node:fs/promises";
const baseline = JSON.parse(await readFile(new URL("../docs/quality-baseline.json", import.meta.url)));
const requested = process.argv[2];
if (requested && !["frontend", "backend"].includes(requested)) throw new Error("Unknown workspace");
for (const workspace of requested ? [requested] : ["frontend", "backend"]) {
  const report = JSON.parse(await readFile(new URL(`../${workspace}/coverage/coverage-summary.json`, import.meta.url)));
  for (const metric of ["statements", "branches", "functions", "lines"]) {
    const actual = report.total?.[metric]; const floor = baseline[workspace].coverage[metric].pct;
    if (!actual || !Number.isFinite(actual.pct) || actual.total <= 0 || actual.pct < floor) throw new Error(`${workspace} ${metric}: ${actual?.pct ?? "missing"}% below ${floor}%`);
    console.log(`${workspace} ${metric}: ${actual.pct}% >= ${floor}%`);
  }
}
