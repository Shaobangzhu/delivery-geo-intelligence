export default {
  name: /^DGI (?:CI \d+|local [a-f0-9]{16})$/.test(process.env.DGI_ALLURE_RUN_NAME ?? "")
    ? process.env.DGI_ALLURE_RUN_NAME : "Delivery Geo Intelligence · Synthetic Test Quality",
  output: "artifacts/allure-report",
  resultsDir: "artifacts/allure-merged",
  historyPath: "artifacts/allure-history/history.jsonl",
  appendHistory: true,
  historyLimit: 30,
  plugins: { awesome: { options: { singleFile: false, groupBy: ["layer", "execution", "parentSuite", "suite", "subSuite"] } } }
};
