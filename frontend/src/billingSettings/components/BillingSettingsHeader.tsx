type Props = {
  onBack: () => void;
  onSave: () => void;
  saveDisabled?: boolean;
};

export default function BillingSettingsHeader({ onBack, onSave, saveDisabled = false }: Props) {
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
          className="billing-settings-btn billing-settings-btn--gold"
          onClick={onSave}
          disabled={saveDisabled}
        >
          Save
        </button>
      </div>
    </header>
  );
}
