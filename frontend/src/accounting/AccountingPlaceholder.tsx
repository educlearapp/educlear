import React from "react";
import {
  ACCOUNTING_GOLD,
  accountingPageWrap,
  accountingSubtitle,
  accountingTitle,
} from "./accountingTheme";

type Props = {
  title: string;
  description: string;
  children?: React.ReactNode;
};

export default function AccountingPlaceholder({ title, description, children }: Props) {
  return (
    <div style={accountingPageWrap}>
      <div
        style={{
          borderBottom: `2px solid ${ACCOUNTING_GOLD}`,
          paddingBottom: 18,
          marginBottom: 28,
        }}
      >
        <h1 style={accountingTitle}>{title}</h1>
        <p style={accountingSubtitle}>{description}</p>
      </div>
      {children || (
        <div
          style={{
            border: `1px dashed ${ACCOUNTING_GOLD}`,
            borderRadius: 12,
            padding: 32,
            textAlign: "center",
            color: "#64748b",
            fontWeight: 700,
            background: "rgba(212,175,55,0.06)",
          }}
        >
          Module coming soon — EduClear Accounting
        </div>
      )}
    </div>
  );
}
