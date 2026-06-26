import { useCallback, useEffect, useMemo, useState } from "react";
import { clearBillingSettingsCache } from "../../billing/billingSettingsEngine";
import {
  fetchBillingSettings,
  resetBillingSettings,
  saveBillingSettings,
} from "../billingSettingsApi";
import { createDefaultBillingSettings } from "../components/billingSettingsConstants";
import type {
  BillingGeneralSettings,
  BillingInvoiceSettings,
  BillingReceiptSettings,
  BillingSettingsState,
  BillingStatementSettings,
  BillingUiPreferences,
  FinancePolicySettings,
} from "../types/billingSettings";

export function useBillingSettings(schoolId: string) {
  const [settingsBySchool, setSettingsBySchool] = useState<Record<string, BillingSettingsState>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settings = useMemo(() => {
    if (!schoolId) return createDefaultBillingSettings();
    return settingsBySchool[schoolId] ?? createDefaultBillingSettings();
  }, [schoolId, settingsBySchool]);

  useEffect(() => {
    if (!schoolId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchBillingSettings(schoolId)
      .then((loaded) => {
        if (cancelled) return;
        setSettingsBySchool((prev) => ({ ...prev, [schoolId]: loaded }));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load billing settings");
        setSettingsBySchool((prev) => ({
          ...prev,
          [schoolId]: prev[schoolId] ?? createDefaultBillingSettings(),
        }));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  const updateSettings = useCallback(
    (updater: (current: BillingSettingsState) => BillingSettingsState) => {
      if (!schoolId) return;
      setSettingsBySchool((prev) => {
        const current = prev[schoolId] ?? createDefaultBillingSettings();
        return { ...prev, [schoolId]: updater(current) };
      });
    },
    [schoolId]
  );

  const setGeneral = useCallback(
    (patch: Partial<BillingGeneralSettings>) => {
      updateSettings((current) => ({
        ...current,
        general: { ...current.general, ...patch },
      }));
    },
    [updateSettings]
  );

  const setGeneralCheckbox = useCallback(
    (
      group: keyof Pick<
        BillingGeneralSettings,
        "quickPopups" | "accountsInfoBlocks" | "invoicesInfoBlocks" | "paymentsInfoBlocks" | "corrections"
      >,
      id: string,
      value: boolean
    ) => {
      updateSettings((current) => ({
        ...current,
        general: {
          ...current.general,
          [group]: { ...current.general[group], [id]: value },
        },
      }));
    },
    [updateSettings]
  );

  const setUiPreferences = useCallback(
    (patch: Partial<BillingUiPreferences>) => {
      updateSettings((current) => ({
        ...current,
        uiPreferences: { ...current.uiPreferences, ...patch },
      }));
    },
    [updateSettings]
  );

  const setFinancePolicy = useCallback(
    (patch: Partial<FinancePolicySettings>) => {
      updateSettings((current) => ({
        ...current,
        financePolicy: { ...current.financePolicy, ...patch },
      }));
    },
    [updateSettings]
  );

  const setStatement = useCallback(
    (patch: Partial<BillingStatementSettings>) => {
      updateSettings((current) => ({
        ...current,
        statement: { ...current.statement, ...patch },
      }));
    },
    [updateSettings]
  );

  const setStatementFeature = useCallback(
    (id: string, value: boolean) => {
      updateSettings((current) => ({
        ...current,
        statement: {
          ...current.statement,
          statementFeatures: { ...current.statement.statementFeatures, [id]: value },
        },
      }));
    },
    [updateSettings]
  );

  const setStatementDisplay = useCallback(
    (field: keyof BillingStatementSettings["displayOnStatement"], value: boolean) => {
      updateSettings((current) => ({
        ...current,
        statement: {
          ...current.statement,
          displayOnStatement: { ...current.statement.displayOnStatement, [field]: value },
        },
      }));
    },
    [updateSettings]
  );

  const setInvoice = useCallback(
    (patch: Partial<BillingInvoiceSettings>) => {
      updateSettings((current) => ({
        ...current,
        invoice: { ...current.invoice, ...patch },
      }));
    },
    [updateSettings]
  );

  const setInvoiceFeature = useCallback(
    (id: string, value: boolean) => {
      updateSettings((current) => ({
        ...current,
        invoice: {
          ...current.invoice,
          invoiceFeatures: { ...current.invoice.invoiceFeatures, [id]: value },
        },
      }));
    },
    [updateSettings]
  );

  const setInvoiceDisplay = useCallback(
    (field: keyof BillingInvoiceSettings["displayOnInvoice"], value: boolean) => {
      updateSettings((current) => ({
        ...current,
        invoice: {
          ...current.invoice,
          displayOnInvoice: { ...current.invoice.displayOnInvoice, [field]: value },
        },
      }));
    },
    [updateSettings]
  );

  const setReceipt = useCallback(
    (patch: Partial<BillingReceiptSettings>) => {
      updateSettings((current) => ({
        ...current,
        receipt: { ...current.receipt, ...patch },
      }));
    },
    [updateSettings]
  );

  const setReceiptFeature = useCallback(
    (id: string, value: boolean) => {
      updateSettings((current) => ({
        ...current,
        receipt: {
          ...current.receipt,
          receiptFeatures: { ...current.receipt.receiptFeatures, [id]: value },
        },
      }));
    },
    [updateSettings]
  );

  const setReceiptDisplay = useCallback(
    (field: keyof BillingReceiptSettings["displayOnReceipt"], value: boolean) => {
      updateSettings((current) => ({
        ...current,
        receipt: {
          ...current.receipt,
          displayOnReceipt: { ...current.receipt.displayOnReceipt, [field]: value },
        },
      }));
    },
    [updateSettings]
  );

  const saveSettings = useCallback(async () => {
    if (!schoolId || saving) return false;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveBillingSettings(schoolId, settings);
      clearBillingSettingsCache(schoolId);
      setSettingsBySchool((prev) => ({ ...prev, [schoolId]: saved }));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save billing settings");
      return false;
    } finally {
      setSaving(false);
    }
  }, [schoolId, saving, settings]);

  const resetSettings = useCallback(async () => {
    if (!schoolId || resetting) return false;
    setResetting(true);
    setError(null);
    try {
      const defaults = await resetBillingSettings(schoolId);
      clearBillingSettingsCache(schoolId);
      setSettingsBySchool((prev) => ({ ...prev, [schoolId]: defaults }));
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset billing settings");
      return false;
    } finally {
      setResetting(false);
    }
  }, [schoolId, resetting]);

  return {
    settings,
    loading,
    saving,
    resetting,
    error,
    setGeneral,
    setGeneralCheckbox,
    setUiPreferences,
    setFinancePolicy,
    setStatement,
    setStatementFeature,
    setStatementDisplay,
    setInvoice,
    setInvoiceFeature,
    setInvoiceDisplay,
    setReceipt,
    setReceiptFeature,
    setReceiptDisplay,
    saveSettings,
    resetSettings,
  };
}
