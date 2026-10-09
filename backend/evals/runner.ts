import { cases } from "./cases.js";
import type { AiDiagnostics } from "../src/ai/types.js";

const categories = new Map<string, { passed: number; total: number }>();
const diagnostics: AiDiagnostics[] = [];
let passed = 0;
console.log("DGI AI EVALUATION — synthetic fixtures / scripted mock provider");
for (const scenario of cases) {
  const category = categories.get(scenario.category) ?? { passed: 0, total: 0 };
  category.total++;
  try {
    await scenario.run({ observe: (value) => diagnostics.push(value) });
    passed++; category.passed++; console.log(`PASS ${scenario.id}`);
  } catch (error) {
    console.error(`FAIL ${scenario.id}: ${error instanceof Error ? error.message : "assertion failed"}`);
  }
  categories.set(scenario.category, category);
}
for (const [name, result] of categories) console.log(`${name}: ${result.passed === result.total ? "PASS" : "FAIL"} (${result.passed}/${result.total})`);
console.log(`Total: ${passed}/${cases.length} passed; Provider calls: 0 real calls`);
console.log(`Mock benchmark (${diagnostics.length} requests, including failure probes; NOT billing):`);
for (const field of ["providerCallCount", "toolCallCount", "inputTokens", "outputTokens", "toolPayloadBytes", "latencyMs", "providerErrorCount"] as const) {
  const values = diagnostics.map((row) => row[field]);
  console.log(`  ${field}: min=${Math.min(...values)}, max=${Math.max(...values)}, total=${values.reduce((sum, value) => sum + value, 0)}`);
}
console.log("Tool plans and Chinese responses are scripted; this does not measure real model routing or language accuracy.");
process.exitCode = passed === cases.length ? 0 : 1;
