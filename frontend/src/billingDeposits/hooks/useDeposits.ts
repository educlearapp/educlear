import { useCallback, useEffect, useState } from "react";
import { createDeposit, fetchDeposits, fetchDepositDetail, updateDeposit } from "../api/depositsApi";
import type { DepositRecord, OpenInvoice } from "../types/deposit";

export function useDeposits(schoolId: string) {
  const [deposits, setDeposits] = useState<DepositRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadDeposits = useCallback(
    async (params?: { search?: string; status?: string }) => {
      if (!schoolId) return;
      setLoading(true);
      setError("");
      try {
        const rows = await fetchDeposits(schoolId, params);
        setDeposits(rows);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load deposits");
        setDeposits([]);
      } finally {
        setLoading(false);
      }
    },
    [schoolId]
  );

  useEffect(() => {
    void loadDeposits();
  }, [loadDeposits]);

  const saveDeposit = useCallback(
    async (payload: Record<string, unknown>) => {
      const created = await createDeposit({ ...payload, schoolId });
      await loadDeposits();
      return created;
    },
    [loadDeposits, schoolId]
  );

  const loadDepositDetail = useCallback(
    async (depositId: string) => {
      return fetchDepositDetail(schoolId, depositId);
    },
    [schoolId]
  );

  const allocateDeposit = useCallback(
    async (
      depositId: string,
      allocations: { ledgerInvoiceId: string; amount: number }[]
    ): Promise<{ deposit: DepositRecord; openInvoices: OpenInvoice[] }> => {
      const result = await updateDeposit(depositId, { schoolId, allocations });
      await loadDeposits();
      return result;
    },
    [loadDeposits, schoolId]
  );

  return {
    deposits,
    loading,
    error,
    loadDeposits,
    saveDeposit,
    loadDepositDetail,
    allocateDeposit,
  };
}
