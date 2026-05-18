import { useCallback, useState } from "react";
import BillingGeneralTab from "../billingSettings/components/tabs/BillingGeneralTab";
import BillingInvoiceTab from "../billingSettings/components/tabs/BillingInvoiceTab";
import BillingJournalTab from "../billingSettings/components/tabs/BillingJournalTab";
import BillingReceiptTab from "../billingSettings/components/tabs/BillingReceiptTab";
import BillingStatementTab from "../billingSettings/components/tabs/BillingStatementTab";
import BillingSettingsHeader from "../billingSettings/components/BillingSettingsHeader";
import BillingSettingsSavedModal from "../billingSettings/components/BillingSettingsSavedModal";
import BillingSettingsTabs from "../billingSettings/components/BillingSettingsTabs";
import { useBillingSettings } from "../billingSettings/hooks/useBillingSettings";
import type { BillingSettingsTab } from "../billingSettings/types/billingSettings";
import { useSchoolId } from "../useSchoolId";
import "./BillingSettingsPage.css";

type Props = {
  onBack: () => void;
};

export default function BillingSettingsPage({ onBack }: Props) {
  const schoolId = useSchoolId();
  const [activeTab, setActiveTab] = useState<BillingSettingsTab>("general");
  const [showSavedModal, setShowSavedModal] = useState(false);
  const {
    settings,
    setGeneral,
    setGeneralCheckbox,
    setStatement,
    setStatementCheckbox,
    setStatementDisplay,
    setInvoice,
    setInvoiceDisplay,
    setReceipt,
    setReceiptDisplay,
    saveSettings,
  } = useBillingSettings(schoolId);

  const handleSave = useCallback(() => {
    const saved = saveSettings();
    if (saved) setShowSavedModal(true);
  }, [saveSettings]);

  if (!schoolId) {
    return (
      <div className="billing-settings-page">
        <h1 className="page-title">Billing Settings</h1>
        <p className="billing-settings-subtitle">Loading school context…</p>
      </div>
    );
  }

  return (
    <div className="billing-settings-page">
      <BillingSettingsHeader onBack={onBack} onSave={handleSave} />

      <BillingSettingsTabs activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="billing-settings-panel" role="tabpanel">
        {activeTab === "general" ? (
          <BillingGeneralTab
            schoolId={schoolId}
            general={settings.general}
            onFieldChange={setGeneral}
            onCheckboxChange={setGeneralCheckbox}
          />
        ) : null}

        {activeTab === "statement" ? (
          <BillingStatementTab
            schoolId={schoolId}
            statement={settings.statement}
            onFieldChange={setStatement}
            onStatementInfoChange={(id, checked) => setStatementCheckbox("statementInfo", id, checked)}
            onDisplayChange={setStatementDisplay}
          />
        ) : null}

        {activeTab === "invoice" ? (
          <BillingInvoiceTab
            schoolId={schoolId}
            invoice={settings.invoice}
            onFieldChange={setInvoice}
            onDisplayChange={setInvoiceDisplay}
          />
        ) : null}

        {activeTab === "receipt" ? (
          <BillingReceiptTab
            schoolId={schoolId}
            receipt={settings.receipt}
            onFieldChange={setReceipt}
            onDisplayChange={setReceiptDisplay}
          />
        ) : null}

        {activeTab === "journal" ? <BillingJournalTab schoolId={schoolId} /> : null}
      </div>

      {showSavedModal ? <BillingSettingsSavedModal onClose={() => setShowSavedModal(false)} /> : null}
    </div>
  );
}
