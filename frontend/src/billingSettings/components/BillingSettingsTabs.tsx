import type { BillingSettingsTab } from "../types/billingSettings";

type Props = {
  activeTab: BillingSettingsTab;
  onTabChange: (tab: BillingSettingsTab) => void;
};

const TABS: { id: BillingSettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "statement", label: "Statement" },
  { id: "invoice", label: "Invoice" },
  { id: "receipt", label: "Receipt" },
  { id: "journal", label: "Journal" },
];

export default function BillingSettingsTabs({ activeTab, onTabChange }: Props) {
  return (
    <div className="billing-settings-tabs" role="tablist" aria-label="Billing settings sections">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`billing-settings-tab ${isActive ? "billing-settings-tab--active" : ""}`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
