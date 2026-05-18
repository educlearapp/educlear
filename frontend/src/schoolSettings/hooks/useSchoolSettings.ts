import { useCallback, useMemo, useState } from "react";
import { createDefaultSchoolSettings } from "../components/schoolSettingsConstants";
import type {
  DocumentDisplayFieldId,
  GeneralSettings,
  SchoolSettingsState,
} from "../types/schoolSettings";

export function useSchoolSettings(schoolId: string) {
  const [settingsBySchool, setSettingsBySchool] = useState<Record<string, SchoolSettingsState>>({});

  const settings = useMemo(() => {
    if (!schoolId) return createDefaultSchoolSettings();
    return settingsBySchool[schoolId] ?? createDefaultSchoolSettings();
  }, [schoolId, settingsBySchool]);

  const updateSettings = useCallback(
    (updater: (current: SchoolSettingsState) => SchoolSettingsState) => {
      if (!schoolId) return;
      setSettingsBySchool((prev) => {
        const current = prev[schoolId] ?? createDefaultSchoolSettings();
        return { ...prev, [schoolId]: updater(current) };
      });
    },
    [schoolId]
  );

  const setGeneralField = useCallback(
    (field: keyof GeneralSettings, value: boolean) => {
      updateSettings((current) => ({
        ...current,
        general: { ...current.general, [field]: value },
      }));
    },
    [updateSettings]
  );

  const setDocumentField = useCallback(
    (field: DocumentDisplayFieldId, value: boolean) => {
      updateSettings((current) => ({
        ...current,
        documents: { ...current.documents, [field]: value },
      }));
    },
    [updateSettings]
  );

  const saveSettings = useCallback(() => {
    if (!schoolId) return false;
    updateSettings((current) => ({ ...current }));
    return true;
  }, [schoolId, updateSettings]);

  return {
    settings,
    setGeneralField,
    setDocumentField,
    saveSettings,
  };
}
