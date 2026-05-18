import { useCallback, useMemo, useState } from "react";
import { createDefaultBillingSettings } from "../components/billingSettingsConstants";
import type {
  BillingGeneralSettings,
  BillingInvoiceSettings,
  BillingReceiptSettings,
  BillingSettingsState,
  BillingStatementSettings,
  CheckboxMap,
} from "../types/billingSettings";

export function useBillingSettings(schoolId: string) {
  const [settingsBySchool, setSettingsBySchool] = useState<Record<string, BillingSettingsState>>({});

  const settings = useMemo(() => {
    if (!schoolId) return createDefaultBillingSettings();
    return settingsBySchool[schoolId] ?? createDefaultBillingSettings();
  }, [schoolId, settingsBySchool]);

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
    (group: keyof Pick<BillingGeneralSettings, "quickPopups" | "accountsInfoBlocks" | "invoicesInfoBlocks" | "paymentsInfoBlocks" | "corrections">, id: string, value: boolean) => {
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

  const setStatement = useCallback(
    (patch: Partial<BillingStatementSettings>) => {
      updateSettings((current) => ({
        ...current,
        statement: { ...current.statement, ...patch },
      }));
    },
    [updateSettings]
  );

  const setStatementCheckbox = useCallback(
    (group: "statementInfo", id: string, value: boolean) => {
      updateSettings((current) => ({
        ...current,
        statement: {
          ...current.statement,
          [group]: { ...(current.statement[group] as CheckboxMap), [id]: value },
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

  const saveSettings = useCallback(() => {
    if (!schoolId) return false;
    updateSettings((current) => ({ ...current }));
    return true;
  }, [schoolId, updateSettings]);

  return {
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
  };
}
