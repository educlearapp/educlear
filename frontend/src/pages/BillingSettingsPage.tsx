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
    loading,
    saving,
    resetting,
    error,
    setGeneral,
    setGeneralCheckbox,
    setStatement,
    setStatementFeature,
    setStatementDisplay,
    setInvoice,
    setInvoiceFeature,
    setInvoiceDisplay,
    setReceipt,
    setReceiptFeature,
    saveSettings,
    resetSettings,
  } = useBillingSettings(schoolId);

  const handleSave = useCallback(async () => {
    const saved = await saveSettings();
    if (saved) setShowSavedModal(true);
  }, [saveSettings]);

  const handleReset = useCallback(async () => {
    const reset = await resetSettings();
    if (reset) setShowSavedModal(true);
  }, [resetSettings]);

  if (!schoolId) {
    return (
      <div className="billing-settings-page">
        <h1 className="page-title">Billing Settings</h1>
        <p className="billing-settings-subtitle">Loading school context…</p>
      </div>
    );
  }

  const actionsDisabled = loading || saving || resetting;

  return (
    <div className="billing-settings-page">
      <BillingSettingsHeader
        onBack={onBack}
        onSave={handleSave}
        onReset={handleReset}
        saveDisabled={actionsDisabled}
        resetDisabled={actionsDisabled}
        saving={saving}
        resetting={resetting}
      />

      {error ? <p className="billing-settings-error">{error}</p> : null}
      {loading ? <p className="billing-settings-loading">Loading settings…</p> : null}

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
            onStatementFeatureChange={setStatementFeature}
            onDisplayChange={setStatementDisplay}
          />
        ) : null}

        {activeTab === "invoice" ? (
          <BillingInvoiceTab
            schoolId={schoolId}
            invoice={settings.invoice}
            onFieldChange={setInvoice}
            onInvoiceFeatureChange={setInvoiceFeature}
            onDisplayChange={setInvoiceDisplay}
          />
        ) : null}

        {activeTab === "receipt" ? (
          <BillingReceiptTab
            schoolId={schoolId}
            receipt={settings.receipt}
            onFieldChange={setReceipt}
            onReceiptFeatureChange={setReceiptFeature}
          />
        ) : null}

        {activeTab === "journal" ? <BillingJournalTab schoolId={schoolId} /> : null}
      </div>

      {showSavedModal ? <BillingSettingsSavedModal onClose={() => setShowSavedModal(false)} /> : null}
    </div>
  );
}
