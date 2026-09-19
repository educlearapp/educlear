export type EnrollmentStatus = "ACTIVE" | "HISTORICAL" | string;

export type RemediationLearner = {
  id: string;
  schoolId: string;
  firstName: string;
  lastName: string;
  enrollmentStatus: EnrollmentStatus;
  className?: string | null;
  grade?: string | null;
  familyAccountId: string | null;
  admissionNo?: string | null;
  birthDate?: string | Date | null;
  createdAt?: string | Date | null;
};

export type RemediationFamilyAccount = {
  id: string;
  schoolId: string;
  accountRef: string;
  accountNo: string | null;
  familyName?: string | null;
  createdAt?: string | Date | null;
  retiredAt?: string | Date | null;
  mergedIntoFamilyAccountId?: string | null;
};

export type RemediationParent = {
  id: string;
  schoolId: string;
  familyAccountId: string | null;
  firstName?: string | null;
  surname?: string | null;
  cellNo?: string | null;
  email?: string | null;
  idNumber?: string | null;
};

export type RemediationParentLearnerLink = {
  parentId: string;
  learnerId: string;
  schoolId: string;
};

export type RemediationLedgerEntry = {
  id?: string;
  type?: string;
  accountNo?: string;
  schoolId?: string;
  learnerId?: string;
  amount?: number;
  date?: string;
  familyAccountId?: string | null;
  reference?: string | null;
  description?: string | null;
};

export type RemediationSnapshot = {
  accountRef: string;
  accountHolder?: string;
  balance?: number;
  source?: string;
  importedAt?: string;
};

export type RemediationAuditEntry = {
  action?: string;
  sourceAccountRef?: string;
  targetAccountRef?: string;
  createdAt?: string;
};

/** Full school-scoped read bundle for snapshot + reconcile. */
export type FlyEagleSchoolBundle = {
  schoolId: string;
  schoolName?: string;
  capturedAt: string;
  learners: RemediationLearner[];
  familyAccounts: RemediationFamilyAccount[];
  parents: RemediationParent[];
  parentLearnerLinks: RemediationParentLearnerLink[];
  ledger: RemediationLedgerEntry[];
  ageAnalysisByRef: Record<string, RemediationSnapshot | undefined>;
  audit: RemediationAuditEntry[];
};

export type MoneyTotals = {
  invoiceCount: number;
  invoiceTotal: number;
  paymentCount: number;
  paymentTotal: number;
  creditCount: number;
  creditTotal: number;
  balanceSumFromSnapshots: number;
  balanceSumFromActiveFasWithSnapshot: number;
};

export type CountChecksums = {
  learnerTotal: number;
  activeLearners: number;
  historicalLearners: number;
  otherStatusLearners: number;
  learnersWithNoFa: number;
  faTotal: number;
  faActive: number;
  faRetiredOrMerged: number;
  faZeroLinked: number;
  faLinked: number;
  faExactly1Linked: number;
  faTwoPlusLinked: number;
  faInactiveOnlyLinked: number;
  parentTotal: number;
  parentLearnerLinkTotal: number;
};

export type OrphanCategory =
  | "LEGITIMATE_HISTORICAL_PREDECESSOR"
  | "VALID_HISTORICAL_NO_REPAIR"
  | "WRONG_FA_LINK"
  | "SPLIT_LEDGER"
  | "DUPLICATE_SHELL"
  | "SIBLING_FAMILY"
  | "HISTORICAL_LEARNER_ACCOUNT"
  | "UNRESOLVED_IDENTITY";

export type RepairClass = "A" | "B" | "C";

export type EvidenceTag =
  | "exact_learner_name"
  | "historical_learner_record"
  | "parent_name"
  | "parent_phone"
  | "parent_email"
  | "account_ref_lineage"
  | "account_no_lineage"
  | "sibling_shared_current_fa"
  | "ledger_on_orphan"
  | "ledger_on_current"
  | "timestamp_proximity"
  | "audit_merge_trail"
  | "audit_unmerge_trail"
  | "current_holds_continuing_ledger"
  | "admission_no";

export type CanonicalLearnerRow = {
  learnerId: string;
  name: string;
  status: string;
  className: string;
  grade: string;
  familyAccountId: string | null;
  accountRef: string | null;
  accountNo: string | null;
  balance: number;
  parentIds: string[];
  parentSummary: string[];
  invoiceCount: number;
  paymentCount: number;
  creditCount: number;
  splitLedger: boolean;
  relatedOrphanFaIds: string[];
};

export type ZeroLinkedFaRow = {
  faId: string;
  accountRef: string;
  accountNo: string | null;
  /** Age-analysis snapshot balance (may lag ledger). */
  balance: number;
  /** Invoice − payment − credit from ledger rows on this accountRef. */
  ledgerBalance: number;
  invoiceCount: number;
  paymentCount: number;
  creditCount: number;
  createdAt: string | null;
  parentIds: string[];
  parentSummary: string[];
  category: OrphanCategory;
  repairClass: RepairClass;
  evidence: EvidenceTag[];
  matchedLearnerIds: string[];
  matchedLearnerNames: string[];
  currentFaIds: string[];
  currentAccountNos: string[];
  reasons: string[];
  proposedAction:
    | "none"
    | "relink_learners_to_orphan_survivor"
    | "relink_parents_to_current_retire_orphan"
    | "merge_shell_into_orphan"
    | "retire_empty_shell"
    | "ledger_consolidate_then_merge"
    | "needs_school_confirmation";
};

export type RepairPlanItem = {
  caseKey: string;
  repairClass: RepairClass;
  orphanFaId: string;
  orphanAccountRef: string;
  orphanAccountNo: string | null;
  action: ZeroLinkedFaRow["proposedAction"];
  learnerIds: string[];
  currentFaIds: string[];
  evidence: EvidenceTag[];
  reasons: string[];
  preconditions: string[];
  monetary: {
    orphanBalance: number;
    orphanInvoiceTotal: number;
    orphanPaymentTotal: number;
  };
};

export type ReconciliationReport = {
  schoolId: string;
  capturedAt: string;
  checksums: CountChecksums;
  money: MoneyTotals;
  activeLearners: CanonicalLearnerRow[];
  zeroLinkedFas: ZeroLinkedFaRow[];
  repairPlan: {
    classA: RepairPlanItem[];
    classB: RepairPlanItem[];
    classC: RepairPlanItem[];
  };
  notes: string[];
};
