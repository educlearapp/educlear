/** Pre-apply simulation counts (read-only; no DB writes except learner existence lookup). */
export type MigrationApplyExpectations = {
  learnerCreatesFromLearnerFiles: number;
  stagedLearnerCount: number;
  maxAllowedLearnerCreates: number;
  parentCreates: number;
  parentLearnerLinks: number;
  billingAccountCreates: number;
  transactionsEligibleToPost: number;
  transactionsStaged: number;
};
