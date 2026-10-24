export default {
  name: "Delivery Geo Intelligence · Synthetic Test Quality",
  output: "artifacts/allure-report",
  resultsDir: "artifacts/allure-merged",
  plugins: { awesome: { options: { singleFile: false, groupBy: ["layer", "execution", "parentSuite", "suite", "subSuite"] } } }
};
