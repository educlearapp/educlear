type Props = {
  onBack: () => void;
  onSave: () => void;
  onReset: () => void;
  saveDisabled?: boolean;
  resetDisabled?: boolean;
  saving?: boolean;
  resetting?: boolean;
};

export default function BillingSettingsHeader({
  onBack,
  onSave,
  onReset,
  saveDisabled = false,
  resetDisabled = false,
  saving = false,
  resetting = false,
}: Props) {
  return (
    <header className="billing-settings-header">
      <div className="billing-settings-header-main">
        <h1 className="page-title billing-settings-title">Billing Settings</h1>
        <p className="billing-settings-subtitle">Change billing related settings and details</p>
      </div>
      <div className="billing-settings-header-actions">
        <button type="button" className="billing-settings-btn billing-settings-btn--outline" onClick={onBack}>
          ← Back
        </button>
        <button
          type="button"
          className="billing-settings-btn billing-settings-btn--outline"
          onClick={onReset}
          disabled={resetDisabled || resetting}
        >
          {resetting ? "Resetting…" : "Reset Defaults"}
        </button>
        <button
          type="button"
          className="billing-settings-btn billing-settings-btn--gold"
          onClick={onSave}
          disabled={saveDisabled || saving}
        >
          {saving ? "Saving…" : "Save Settings"}
        </button>
      </div>
    </header>
  );
}
