import React from "react";
import BankStatementImport from "../banking/BankStatementImport";
import { ACCOUNTING_GOLD, accountingPageWrap, accountingSubtitle, accountingTitle } from "./accountingTheme";

type Props = {
  schoolId: string;
  learners: any[];
};

export default function AccountingBanking({ schoolId, learners }: Props) {
  return (
    <div>
      <div style={{ ...accountingPageWrap, paddingBottom: 0 }}>
        <div style={{ borderBottom: `2px solid ${ACCOUNTING_GOLD}`, paddingBottom: 14, marginBottom: 8 }}>
          <h1 style={{ ...accountingTitle, fontSize: 26 }}>Bank Reconciliation</h1>
          <p style={accountingSubtitle}>
            Import bank statements, review the match queue, accept payments, and post to Billing — with duplicate
            protection and import history per batch.
          </p>
        </div>
      </div>
      <BankStatementImport schoolId={schoolId} learners={learners} />
    </div>
  );
}
