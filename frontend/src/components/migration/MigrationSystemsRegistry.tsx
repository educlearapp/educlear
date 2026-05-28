import { useCallback, useEffect, useState } from "react";
import {
  fetchMigrationSystems,
  type MigrationAdapterStatus,
  type MigrationSystemResearch,
} from "../../superAdmin/utils/universalMigrationSystems";
import {
  deriveAdapterReadinessUiStatus,
  fetchReadinessTemplate,
  readinessUiStatusLabel,
  type MigrationAdapterReadinessTemplate,
} from "../../superAdmin/utils/universalMigrationReadiness";
import AdapterReadinessDetail from "./AdapterReadinessDetail";
import "./MigrationSystemsRegistry.css";

function formatReviewedAt(iso: string): string {
  const trimmed = String(iso || "").trim();
  if (!trimmed) return "—";
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return trimmed;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatExportTypes(types: string[]): string {
  if (!types.length) return "—";
  return types.map((t) => t.replace(/_/g, " ")).join(", ");
}

function capabilityCell(supported: boolean): string {
  return supported ? "Yes" : "—";
}

function statusLabel(status: MigrationAdapterStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function MigrationSystemsRegistry() {
  const [systems, setSystems] = useState<MigrationSystemResearch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSystem, setSelectedSystem] = useState<MigrationSystemResearch | null>(null);
  const [readinessTemplate, setReadinessTemplate] = useState<MigrationAdapterReadinessTemplate | null>(
    null
  );
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchMigrationSystems();
      setSystems(rows);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load systems registry");
      setSystems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openSystem = useCallback(async (row: MigrationSystemResearch) => {
    setSelectedSystem(row);
    setReadinessTemplate(null);
    setReadinessError(null);
    setReadinessLoading(true);
    try {
      const template = await fetchReadinessTemplate(row.systemId);
      setReadinessTemplate(template);
    } catch (e: unknown) {
      setReadinessError(e instanceof Error ? e.message : "Failed to load readiness template");
    } finally {
      setReadinessLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedSystem(null);
    setReadinessTemplate(null);
    setReadinessError(null);
  }, []);

  return (
    <div className="uc-migration-systems-registry">
      <div className="uc-migration-systems-registry-toolbar">
        <p className="uc-migration-systems-registry-intro">
          Formal research registry for South African school management systems. Adapter readiness templates
          describe expected files and fields before upload — no live migration runs from this panel.
        </p>
        <button type="button" className="uc-migration-systems-registry-refresh" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="uc-migration-systems-registry-status" role="status">
          Loading systems registry…
        </p>
      ) : null}

      {error ? (
        <p className="uc-migration-systems-registry-error" role="alert">
          {error}
        </p>
      ) : null}

      {!loading && !error ? (
        <div className="uc-migration-systems-registry-table-wrap">
          <div className="uc-migration-systems-registry-table-scroll">
            <table className="uc-migration-systems-registry-table">
              <thead>
                <tr>
                  <th>System</th>
                  <th>Vendor</th>
                  <th>Export types</th>
                  <th>Learners</th>
                  <th>Parents</th>
                  <th>Billing</th>
                  <th>Transactions</th>
                  <th>Adapter status</th>
                  <th>Readiness</th>
                  <th>Templates</th>
                  <th>Last reviewed</th>
                </tr>
              </thead>
              <tbody>
                {systems.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="uc-migration-systems-registry-empty">
                      No systems in the registry yet.
                    </td>
                  </tr>
                ) : (
                  systems.map((row) => {
                    const readinessStatus = deriveAdapterReadinessUiStatus(row.adapterStatus);
                    const isSelected = selectedSystem?.systemId === row.systemId;
                    return (
                      <tr
                        key={row.systemId}
                        className={isSelected ? "uc-migration-systems-registry-row--selected" : ""}
                      >
                        <td className="uc-migration-systems-registry-system">
                          <button
                            type="button"
                            className="uc-migration-systems-registry-open"
                            onClick={() => void openSystem(row)}
                            aria-expanded={isSelected}
                          >
                            <span className="uc-migration-systems-registry-system-name">{row.systemName}</span>
                            <span className="uc-migration-systems-registry-system-id">{row.systemId}</span>
                          </button>
                        </td>
                        <td>{row.vendor || "—"}</td>
                        <td>{formatExportTypes(row.exportTypes)}</td>
                        <td>{capabilityCell(row.supportsLearners)}</td>
                        <td>{capabilityCell(row.supportsParents)}</td>
                        <td>{capabilityCell(row.supportsBilling)}</td>
                        <td>{capabilityCell(row.supportsTransactions)}</td>
                        <td>
                          <span
                            className={`uc-migration-systems-registry-badge uc-migration-systems-registry-badge--${row.adapterStatus}`}
                          >
                            {statusLabel(row.adapterStatus)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`uc-migration-readiness-pill uc-migration-readiness-pill--${readinessStatus}`}
                          >
                            {readinessUiStatusLabel(readinessStatus)}
                          </span>
                        </td>
                        <td className="uc-migration-systems-registry-templates">{row.templateCount}</td>
                        <td>{formatReviewedAt(row.lastReviewedAt)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {selectedSystem ? (
        <AdapterReadinessDetail
          system={selectedSystem}
          template={readinessTemplate}
          templateLoading={readinessLoading}
          templateError={readinessError}
          onClose={closeDetail}
        />
      ) : null}
    </div>
  );
}
