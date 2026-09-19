/**
 * Fly Eagle Class B — ONLY the two production-approved consolidation specs.
 * No generic merge. Apply path refuses any Class B case not in this allowlist.
 */
import type { LedgerMoveRow } from "./ledgerConsolidate";

export type ApprovedClassBSpec = {
  /** Stable label for logs */
  label: "LEDIKWA" | "MAPUTLA" | string;
  caseKeyPrefix?: string;
  orphanFaId: string;
  orphanAccountRef: string;
  currentFaId: string;
  currentAccountRef: string;
  currentAccountNo: string;
  learnerIds: string[];
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

/** Production-approved LEDIKWA RELESEGO → LED002 (6 moves). */
export const APPROVED_LEDIKWA: ApprovedClassBSpec = {
  label: "LEDIKWA",
  orphanFaId: "cmt7tn8420070ilmls6iscyzy",
  orphanAccountRef: "LEDIKWA RELESEGO",
  currentFaId: "cmt7tn85g0072ilmllagihesm",
  currentAccountRef: "LEDIKWA RELESEGO JOSIA",
  currentAccountNo: "LED002",
  learnerIds: ["cmt7to4fl015gilmlipianxvm"],
  moves: [
    {
      id: "fe-open-feafb6e2ea28f958bb75",
      type: "credit",
      date: "2018-01-01",
      amount: 2700,
      reference: "FE-OPEN-LEDIKWA RELESEGO",
      fromAccountNo: "LEDIKWA RELESEGO",
      toAccountNo: "LEDIKWA RELESEGO JOSIA",
    },
    {
      id: "fe-inv-ca25ab6061f11ad6c52f",
      type: "invoice",
      date: "2026-02-01",
      amount: 1350,
      reference: "0217902",
      fromAccountNo: "LEDIKWA RELESEGO",
      toAccountNo: "LEDIKWA RELESEGO JOSIA",
    },
    {
      id: "fe-inv-5ac9f6299403ed06c6f3",
      type: "invoice",
      date: "2026-01-04",
      amount: 1350,
      reference: "0217802",
      fromAccountNo: "LEDIKWA RELESEGO",
      toAccountNo: "LEDIKWA RELESEGO JOSIA",
    },
    {
      id: "fe-inv-cb0657ef41a55ef00c23",
      type: "invoice",
      date: "2026-02-10",
      amount: 2050,
      reference: "0217801",
      fromAccountNo: "LEDIKWA RELESEGO",
      toAccountNo: "LEDIKWA RELESEGO JOSIA",
    },
    {
      id: "fe-rcp-05eed073524c9106721a",
      type: "payment",
      date: "2026-01-13",
      amount: 700,
      reference: "15427",
      fromAccountNo: "LEDIKWA RELESEGO",
      toAccountNo: "LEDIKWA RELESEGO JOSIA",
    },
    {
      id: "fe-rcp-797dbbedf4476c71664d",
      type: "payment",
      date: "2026-01-24",
      amount: 1350,
      reference: "17294",
      fromAccountNo: "LEDIKWA RELESEGO",
      toAccountNo: "LEDIKWA RELESEGO JOSIA",
    },
  ],
  expectedCombined: {
    invoiceTotal: 18950,
    paymentTotal: 14900,
    creditTotal: 2700,
    balance: 1350,
  },
};

/** Production-approved MAPUTLA MAROPENG LEANDRA → MAP003 (2 moves). */
export const APPROVED_MAPUTLA: ApprovedClassBSpec = {
  label: "MAPUTLA",
  orphanFaId: "cmt7tnb7o00bgilmltgk08lvh",
  orphanAccountRef: "MAPUTLA MAROPENG LEANDRA",
  currentFaId: "cmt7tnb6a00beilml87mwg69k",
  currentAccountRef: "MAPUTLA MAROPENG",
  currentAccountNo: "MAP003",
  learnerIds: ["cmt7toayp01a4ilmll9vxdnsq"],
  moves: [
    {
      id: "fe-open-dce0944e17cafb557137",
      type: "credit",
      date: "2018-01-01",
      amount: 1300,
      reference: "FE-OPEN-MAPUTLA MAROPENG LEANDRA",
      fromAccountNo: "MAPUTLA MAROPENG LEANDRA",
      toAccountNo: "MAPUTLA MAROPENG",
    },
    {
      id: "fe-inv-b3c8378a4fa64745a1e2",
      type: "invoice",
      date: "2026-03-04",
      amount: 1300,
      reference: "0218412",
      fromAccountNo: "MAPUTLA MAROPENG LEANDRA",
      toAccountNo: "MAPUTLA MAROPENG",
    },
  ],
  expectedCombined: {
    invoiceTotal: 15500,
    paymentTotal: 12050,
    creditTotal: 2100,
    balance: 1350,
  },
};

/** Hard allowlist — production apply may only consume these two. */
export const PRODUCTION_APPROVED_CLASS_B: readonly ApprovedClassBSpec[] = [
  APPROVED_LEDIKWA,
  APPROVED_MAPUTLA,
];

export function matchApprovedClassB(
  orphanFaId: string,
  currentFaId: string,
  orphanAccountRef: string,
  allowlist: readonly ApprovedClassBSpec[] = PRODUCTION_APPROVED_CLASS_B
): ApprovedClassBSpec | null {
  const orphan = String(orphanFaId || "").trim();
  const current = String(currentFaId || "").trim();
  const ref = String(orphanAccountRef || "").trim().toUpperCase();
  for (const spec of allowlist) {
    if (
      spec.orphanFaId === orphan &&
      spec.currentFaId === current &&
      String(spec.orphanAccountRef).trim().toUpperCase() === ref
    ) {
      return spec;
    }
  }
  return null;
}
