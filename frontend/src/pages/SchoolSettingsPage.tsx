import { useCallback, useState } from "react";
import { useSchoolId } from "../useSchoolId";
import AdmissionsSettingsTab from "../schoolSettings/components/AdmissionsSettingsTab";
import DocumentsSettingsTab from "../schoolSettings/components/DocumentsSettingsTab";
import GeneralSettingsTab from "../schoolSettings/components/GeneralSettingsTab";
import SettingsHeader from "../schoolSettings/components/SettingsHeader";
import SettingsSavedModal from "../schoolSettings/components/SettingsSavedModal";
import SettingsTabs from "../schoolSettings/components/SettingsTabs";
import { useSchoolSettings } from "../schoolSettings/hooks/useSchoolSettings";
import type { SchoolSettingsTab } from "../schoolSettings/types/schoolSettings";
import { hasPermission } from "../users/permissions";
import { getSchoolSessionUser } from "../auth/schoolSession";
import "./SchoolSettingsPage.css";

type Props = {
  onBack: () => void;
};

export default function SchoolSettingsPage({ onBack }: Props) {
  const schoolId = useSchoolId();
  const [activeTab, setActiveTab] = useState<SchoolSettingsTab>("general");
  const [showSavedModal, setShowSavedModal] = useState(false);
  const { settings, setGeneralField, setDocumentField, saveSettings } = useSchoolSettings(schoolId);
  const sessionUser = getSchoolSessionUser();
  const canViewAdmissions = hasPermission(sessionUser, "admissions", "view");
  const canManageAdmissions = hasPermission(sessionUser, "admissions", "manage");

  const handleSave = useCallback(() => {
    if (activeTab === "admissions") return;
    const saved = saveSettings();
    if (saved) setShowSavedModal(true);
  }, [activeTab, saveSettings]);

  if (!schoolId) {
    return (
      <div className="school-settings-page">
        <h1 className="page-title">School Settings</h1>
        <p className="school-settings-subtitle">Loading school context…</p>
      </div>
    );
  }

  return (
    <div className="school-settings-page">
      <SettingsHeader
        onBack={onBack}
        onSave={handleSave}
        saveDisabled={activeTab === "admissions"}
      />

      <SettingsTabs activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="school-settings-panel" role="tabpanel">
        {activeTab === "general" ? (
          <GeneralSettingsTab
            schoolId={schoolId}
            general={settings.general}
            onFieldChange={setGeneralField}
          />
        ) : activeTab === "documents" ? (
          <DocumentsSettingsTab
            schoolId={schoolId}
            documents={settings.documents}
            onFieldChange={setDocumentField}
          />
        ) : canViewAdmissions || canManageAdmissions ? (
          <AdmissionsSettingsTab
            canManage={canManageAdmissions}
            onSaved={() => setShowSavedModal(true)}
          />
        ) : (
          <p className="school-settings-card-hint">
            You do not have permission to view Online Admissions settings.
          </p>
        )}
      </div>

      {showSavedModal ? <SettingsSavedModal onClose={() => setShowSavedModal(false)} /> : null}
    </div>
  );
}
