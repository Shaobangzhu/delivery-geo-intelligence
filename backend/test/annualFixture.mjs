// Entirely synthetic; no personal source statements or financial figures.
export function annualFixture(year = 2022) {
  return {
    year, sources: { uberTaxSummary: true, form1099K: true, form1099NEC: true },
    annual: { completedTrips: 12, onlineMiles: 120, grossTripEarnings: 100, tips: 20, grossTripTotal: 120, additionalEarnings: 30, grossPayment: 150, expensesFeesTax: 24, netPayout: 126,
      uberServiceFeeOtherAdjustments: 20, driverOccAccInsuranceExpense: 4, expensesBreakdownComplete: true,
      additionalBreakdown: { incentives: 5, otherMiscellaneousPayment: 21, driverOccAccInsurance: 4 }, additionalBreakdownComplete: true },
    taxForms: { form1099K: { box1aGrossTransactions: 120, paymentTransactionCount: 12 }, form1099NEC: { box1NonemployeeCompensation: 30 } },
    monthlyActivity: Array.from({ length: 12 }, (_, index) => ({ month: index + 1, completedTrips: 1, onlineMiles: 10, form1099KGrossTransactions: 10 }))
  };
}
