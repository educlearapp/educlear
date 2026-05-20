import { useCallback, useEffect, useMemo, useState } from "react";
import { createDefaultSchoolSettings } from "../components/schoolSettingsConstants";
import type {
  DocumentDisplayFieldId,
  GeneralSettings,
  SchoolSettingsState,
} from "../types/schoolSettings";

const storageKey = (schoolId: string) => `educlearSchoolSettings:${schoolId}`;

function readStoredSettings(schoolId: string): SchoolSettingsState | null {
  try {
    const raw = localStorage.getItem(storageKey(schoolId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SchoolSettingsState;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      ...createDefaultSchoolSettings(),
      ...parsed,
      general: {
        ...createDefaultSchoolSettings().general,
        ...(parsed.general || {}),
      },
      documents: {
        ...createDefaultSchoolSettings().documents,
        ...(parsed.documents || {}),
      },
    };
  } catch {
    return null;
  }
}

export function useSchoolSettings(schoolId: string) {
  const [settingsBySchool, setSettingsBySchool] = useState<Record<string, SchoolSettingsState>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!schoolId) {
      setLoaded(true);
      return;
    }
    const stored = readStoredSettings(schoolId);
    if (stored) {
      setSettingsBySchool((prev) => ({ ...prev, [schoolId]: stored }));
    }
    setLoaded(true);
  }, [schoolId]);

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
    try {
      localStorage.setItem(storageKey(schoolId), JSON.stringify(settings));
      setSettingsBySchool((prev) => ({ ...prev, [schoolId]: settings }));
      return true;
    } catch {
      return false;
    }
  }, [schoolId, settings]);

  return {
    settings,
    loaded,
    setGeneralField,
    setDocumentField,
    saveSettings,
  };
}
