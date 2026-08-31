import React from "react";
import BankStatementImport from "../banking/BankStatementImport";
import { ACCOUNTING_GOLD, accountingPageWrap, accountingSubtitle, accountingTitle } from "./accountingTheme";

type Props = {
  schoolId: string;
  learners: any[];
  onOpenPaymentCreate?: () => void;
};

export default function AccountingBanking({ schoolId, learners }: Props) {
  return (
    <div>
      <div style={{ ...accountingPageWrap, padding: "16px 32px 0" }}>
        <div style={{ borderBottom: `1px solid ${ACCOUNTING_GOLD}`, paddingBottom: 10, marginBottom: 4 }}>
          <h1 style={{ ...accountingTitle, fontSize: 20 }}>Bank Reconciliation</h1>
          <p style={{ ...accountingSubtitle, fontSize: 13, margin: "4px 0 0" }}>
            Import bank statements, review the match queue, accept payments, and post to Billing — with duplicate
            protection and import history per batch.
          </p>
        </div>
      </div>
      <BankStatementImport schoolId={schoolId} learners={learners} />
    </div>
  );
}
