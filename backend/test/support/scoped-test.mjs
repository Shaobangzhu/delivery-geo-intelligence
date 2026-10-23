import nativeTest from "node:test";
const scope = process.env.DGI_TEST_SCOPE ?? "all";
if (!["all", "unit", "integration"].includes(scope)) throw new Error("Invalid test scope");
function register(integration, name, ...args) {
  if ((scope === "unit" && integration) || (scope === "integration" && !integration)) return;
  return nativeTest(name, ...args);
}
const test = (name, ...args) => register(false, name, ...args);
test.integration = (name, ...args) => register(true, name, ...args);
export default test;
