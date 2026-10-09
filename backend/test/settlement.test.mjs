import assert from "node:assert/strict";
import test from "node:test";
import { reconcileSettlement } from "../dist/settlement.js";
import { earningsAdjustmentInputSchema, earningsAdjustmentPatchSchema } from "../dist/model.js";

const payment = (amount, guarantee, eligible) => ({ amount, settlementDetails: {
  reportedGuaranteedAmount: guarantee, eligibleEarningsExcludingTips: eligible
} });
test("reported guarantee reconciliation uses cents, missing values, floor, and inclusive one-cent tolerance", () => {
  assert.deepEqual(reconcileSettlement(payment(24.17, 124.17, 100)), {
    method: "reported_guarantee", status: "matched", receivedAdjustment: 24.17,
    expectedAdjustment: 24.17, difference: 0, tolerance: 0.01
  });
  for (const [amount, status, difference] of [[24.16, "matched", -0.01], [24.18, "matched", 0.01], [24.15, "mismatch", -0.02], [24.19, "mismatch", 0.02]]) {
    const result = reconcileSettlement(payment(amount, 124.17, 100));
    assert.equal(result.status, status); assert.equal(result.difference, difference);
  }
  assert.equal(reconcileSettlement(payment(0.1, 0.3, 0.2)).difference, 0);
  assert.equal(reconcileSettlement(payment(24.17, 24.17, 0)).status, "matched");
  assert.equal(reconcileSettlement(payment(5, 10, 20)).expectedAdjustment, 0);
  assert.equal(reconcileSettlement(payment(5, 0, 0)).status, "mismatch");
  for (const row of [{ amount: 5 }, payment(5, undefined, 0), payment(5, 10, undefined),
    payment(5, NaN, 1), payment(5, -1, 1), payment(5, 10, Infinity), payment(5, 1.001, 0), payment(5, "10", 1), payment(Infinity, 10, 1)]) {
    const result = reconcileSettlement(row);
    assert.equal(result.status, "insufficient_data"); assert.equal(result.expectedAdjustment, null); assert.equal(result.difference, null);
  }
});
test("settlement observations validate without rounding or inferring missing fields", () => {
  const base = { type: "prop22_guarantee", paymentDate: "2026-10-08", amount: 24.17 };
  const details = { engagedSeconds: 0, engagedMiles: 12.3456789, eligibleEarningsExcludingTips: 0, reportedGuaranteedAmount: 24.17 };
  assert.deepEqual(earningsAdjustmentInputSchema.parse({ ...base, settlementDetails: details }).settlementDetails, details);
  for (const bad of [{ engagedSeconds: -1 }, { engagedSeconds: 1.5 }, { engagedSeconds: "5" },
    { engagedSeconds: Infinity }, { engagedMiles: -1 }, { engagedMiles: Infinity },
    { eligibleEarningsExcludingTips: -1 }, { reportedGuaranteedAmount: 1.001 },
    { reportedGuaranteedAmount: "12" }, { reportedGuaranteedAmount: Number.MAX_VALUE }, { tips: 1 }]) {
    assert.equal(earningsAdjustmentInputSchema.safeParse({ ...base, settlementDetails: bad }).success, false);
    assert.equal(earningsAdjustmentPatchSchema.safeParse({ settlementDetails: bad }).success, false);
  }
  assert.equal(earningsAdjustmentInputSchema.safeParse({ ...base, settlementDetails: null }).success, false);
  assert.equal(earningsAdjustmentPatchSchema.safeParse({ settlementDetails: null }).success, true);
  assert.equal(earningsAdjustmentPatchSchema.safeParse({ settlementDetails: { engagedSeconds: null } }).success, true);
  assert.equal(earningsAdjustmentPatchSchema.safeParse({ settlementDetails: {} }).success, false);
});
