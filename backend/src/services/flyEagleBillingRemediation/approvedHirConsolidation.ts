/**
 * Fly Eagle — approved HIR003 → HIR002 consolidation (user-confirmed).
 * HIR001 (Bereket) must never be modified.
 */
import type { LedgerMoveRow } from "./ledgerConsolidate";

export type ApprovedHirConsolidationSpec = {
  label: "HIRBORO";
  /** Wrong current shell holding ANTEFAZEN */
  sourceFaId: string;
  sourceAccountRef: string;
  sourceAccountNo: string;
  /** Canonical destination */
  destFaId: string;
  destAccountRef: string;
  destAccountNo: string;
  /** Sibling that must remain untouched */
  protectedSiblingFaId: string;
  protectedSiblingAccountNo: string;
  learnerId: string;
  learnerName: string;
  parentIds: string[];
  moves: ReadonlyArray<
    Pick<LedgerMoveRow, "id" | "type" | "date" | "amount" | "reference" | "fromAccountNo" | "toAccountNo">
  >;
  expectedCombined: {
    invoiceTotal: number;
    paymentTotal: number;
    creditTotal: number;
    balance: number;
  };
};

/** Production-approved: ANTEFAZEN + HIR003 ledger → HIR002 (HIRBORO ANTEFAZA). */
export const APPROVED_HIRBORO: ApprovedHirConsolidationSpec = {
  label: "HIRBORO",
  sourceFaId: "cmu5by3y601kpgo0bbbwcs2d4",
  sourceAccountRef: "HIR003",
  sourceAccountNo: "HIR003",
  destFaId: "cmt7tn6af004eilmlykcryty6",
  destAccountRef: "HIRBORO ANTEFAZA",
  destAccountNo: "HIR002",
  protectedSiblingFaId: "cmt7tn6bu004gilmlbxkjoh95",
  protectedSiblingAccountNo: "HIR001",
  learnerId: "cmu5by41b01krgo0bnct79n3q",
  learnerName: "ANTEFAZEN HIRBORO",
  parentIds: ["cmu5by4ur01kxgo0bqrj926nd", "cmu5by4gx01ktgo0bmledmolf"],
  moves: [
    {
      id: "invoice-draft:cmt1e8bjp0jo8lcjeketlynhl:2026-10-cmu5by41b01krgo0bnct79n3q",
      type: "invoice",
      date: "2026-09-18",
      amount: 1450,
      reference: "INV-1789741428761",
      fromAccountNo: "HIR003",
      toAccountNo: "HIRBORO ANTEFAZA",
    },
  ],
  expectedCombined: {
    invoiceTotal: 17250,
    paymentTotal: 12900,
    creditTotal: 0,
    balance: 4350,
  },
};
