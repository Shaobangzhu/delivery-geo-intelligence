import type { Prop22SettlementDetails } from "./model.js";

export interface SettlementReconciliation {
  method: "reported_guarantee";
  status: "insufficient_data" | "matched" | "mismatch";
  receivedAdjustment: number;
  expectedAdjustment: number | null;
  difference: number | null;
  tolerance: number;
}

/** Diagnostic only. The received amount remains the accounting source of truth. */
export function reconcileSettlement(payment: { amount: number; settlementDetails?: Prop22SettlementDetails }): SettlementReconciliation {
  const result: SettlementReconciliation = {
    method: "reported_guarantee", status: "insufficient_data", receivedAdjustment: payment.amount,
    expectedAdjustment: null, difference: null, tolerance: 0.01
  };
  const guarantee = payment.settlementDetails?.reportedGuaranteedAmount;
  const eligible = payment.settlementDetails?.eligibleEarningsExcludingTips;
  // Defensive handling for corrupted old documents, as well as missing inputs.
  const validMoney = (value: unknown): value is number => typeof value === "number" &&
    Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) &&
    Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
  if (!validMoney(payment.amount) || !validMoney(guarantee) || !validMoney(eligible)) return result;
  const expectedCents = Math.max(0, Math.round(guarantee * 100) - Math.round(eligible * 100));
  const differenceCents = Math.round(payment.amount * 100) - expectedCents;
  return { ...result, status: Math.abs(differenceCents) <= 1 ? "matched" : "mismatch",
    expectedAdjustment: expectedCents / 100, difference: differenceCents / 100 };
}
