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
          <h1 style={{ ...accountingTitle, fontSize: 26 }}>Banking</h1>
          <p style={accountingSubtitle}>
            Bank statements, reconciliation, and payment matching. Incoming payments still post to Billing.
          </p>
        </div>
      </div>
      <BankStatementImport schoolId={schoolId} learners={learners} />
    </div>
  );
}
