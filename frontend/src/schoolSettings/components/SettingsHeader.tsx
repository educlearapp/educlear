type Props = {
  onBack: () => void;
  onSave: () => void;
  saveDisabled?: boolean;
};

export default function SettingsHeader({ onBack, onSave, saveDisabled = false }: Props) {
  return (
    <header className="school-settings-header">
      <div className="school-settings-header-main">
        <h1 className="page-title school-settings-title">School Settings</h1>
        <p className="school-settings-subtitle">
          Configure school modes and document display options for your institution.
        </p>
      </div>
      <div className="school-settings-header-actions">
        <button type="button" className="school-settings-btn school-settings-btn--outline" onClick={onBack}>
          ← Back
        </button>
        <button
          type="button"
          className="school-settings-btn school-settings-btn--gold"
          onClick={onSave}
          disabled={saveDisabled}
        >
          Save
        </button>
      </div>
    </header>
  );
}
