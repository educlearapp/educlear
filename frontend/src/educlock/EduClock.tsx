import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import EduClockOwnerStaffPage, { type StaffReadinessCache } from "./EduClockOwnerStaffPage";
import EduClockAttendanceTab from "./EduClockAttendanceTab";
import EduClockExceptionsTab from "./EduClockExceptionsTab";
import EduClockGeofencesTab from "./EduClockGeofencesTab";
import {
  fetchOwnerEduClockAttendance,
  fetchOwnerEduClockReadiness,
} from "./educlockApi";
import {
  PreparationProgress,
  ownerCardStyle,
} from "./educlockOwnerUi";

type TabKey =
  | "overview"
  | "staff"
  | "attendance"
  | "exceptions"
  | "geofences"
  | "reports"
  | "settings";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "staff", label: "Staff" },
  { key: "attendance", label: "Attendance" },
  { key: "exceptions", label: "Exceptions" },
  { key: "geofences", label: "Geofences" },
  { key: "reports", label: "Reports" },
  { key: "settings", label: "Settings" },
];

const REPORT_PLACEHOLDERS = [
  "Daily Attendance",
  "Staff Timesheets",
  "Late Arrivals",
  "Missed Clock Outs",
  "Geofence Exceptions",
  "Payroll Export",
  "Excel Export",
];

const cardStyle: CSSProperties = ownerCardStyle;

const disabledCardStyle: CSSProperties = {
  ...cardStyle,
  opacity: 0.55,
  background: "#f8fafc",
};

function StatCard(props: {
  label: string;
  value: string | number;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <div style={props.disabled ? disabledCardStyle : cardStyle}>
      <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>{props.label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, marginTop: 6 }}>{props.value}</div>
      {props.hint ? (
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>{props.hint}</div>
      ) : null}
    </div>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ ...cardStyle, marginTop: 8, maxWidth: 720 }}>
      <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
      <p style={{ marginTop: 8, color: "#64748b", lineHeight: 1.55 }}>{body}</p>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={cardStyle}>
      <div
        style={{
          fontWeight: 800,
          fontSize: 13,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "#d4af37",
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * Single Owner/Admin EduClock control centre — polished Owner experience (Build 3.5).
 */
export default function EduClock() {
  const [tab, setTab] = useState<TabKey>("overview");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [dayCounts, setDayCounts] = useState<Record<string, number>>({});
  const [schoolLocalDate, setSchoolLocalDate] = useState("");
  const [loadError, setLoadError] = useState("");
  const [readinessCache, setReadinessCache] = useState<StaffReadinessCache | null>(null);
  const [overviewLoaded, setOverviewLoaded] = useState(false);
  const [employeesForPrep, setEmployeesForPrep] = useState<
    Array<{ linkedUserId?: string | null; isActive: boolean }>
  >([]);

  const loadOverview = useCallback(async (force = false) => {
    if (overviewLoaded && !force) return;
    try {
      const [readiness, attendance] = await Promise.all([
        fetchOwnerEduClockReadiness(),
        fetchOwnerEduClockAttendance({ pageSize: 1 }),
      ]);
      const nextCounts = readiness.counts || {};
      const nextTotals = readiness.totals || {};
      const nextEmployees = (readiness.employees || []) as StaffReadinessCache["employees"];
      setCounts(nextCounts);
      setTotals(nextTotals);
      setDayCounts(attendance.counts || {});
      setSchoolLocalDate(attendance.schoolLocalDate || "");
      setEmployeesForPrep(nextEmployees);
      setReadinessCache({
        counts: nextCounts,
        totals: nextTotals,
        employees: nextEmployees,
        usersWithoutEmployee: readiness.usersWithoutEmployee || [],
      });
      setOverviewLoaded(true);
      setLoadError("");
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Failed to load overview");
    }
  }, [overviewLoaded]);

  useEffect(() => {
    if (tab === "overview" || tab === "settings") {
      void loadOverview();
    }
  }, [tab, loadOverview]);

  const totalEmployees = Number(totals.employees || 0);
  const readyToActivate = Number(counts.readyToActivate || 0);
  const alreadyActivated = Number(counts.alreadyActivated || 0);
  const readyCombined = readyToActivate + alreadyActivated;
  const needingPrep = Math.max(0, totalEmployees - readyCombined);
  const missingUserLink = employeesForPrep.filter((e) => e.isActive && !e.linkedUserId).length;
  const activeEmployees = Math.max(
    0,
    Number(totals.employees || 0) - Number(totals.inactiveEmployees || 0)
  );

  const handleReadinessUpdated = useCallback((cache: StaffReadinessCache) => {
    setReadinessCache(cache);
    setCounts(cache.counts);
    setTotals(cache.totals);
    setEmployeesForPrep(cache.employees);
    setOverviewLoaded(true);
  }, []);

  return (
    <div style={{ padding: "8px 4px 28px", maxWidth: 1200 }}>
      <h1 className="page-title" style={{ marginBottom: 4 }}>
        EduClock
      </h1>
      <p style={{ color: "#64748b", marginTop: 0, maxWidth: 820, lineHeight: 1.5 }}>
        Owner control centre for staff readiness, daily attendance, campuses, and corrections. Staff
        clock on the separate mobile route <code>/educlock</code>.
      </p>

      <div
        role="tablist"
        aria-label="EduClock sections"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginTop: 16,
          borderBottom: "1px solid #e5e7eb",
          paddingBottom: 8,
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const idx = TABS.findIndex((x) => x.key === tab);
              const next =
                e.key === "ArrowRight"
                  ? TABS[(idx + 1) % TABS.length]
                  : TABS[(idx - 1 + TABS.length) % TABS.length];
              setTab(next.key);
            }}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: tab === t.key ? "1px solid #c9a227" : "1px solid #e5e7eb",
              background: tab === t.key ? "#111827" : "#fff",
              color: tab === t.key ? "#fbbf24" : "#334155",
              fontWeight: 700,
              cursor: "pointer",
              outlineOffset: 2,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" style={{ marginTop: 16 }}>
        {tab === "overview" && (
          <div>
            {loadError ? (
              <p role="alert" style={{ color: "#b91c1c" }}>
                {loadError}
              </p>
            ) : null}
            {schoolLocalDate ? (
              <p style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>
                School-local day: {schoolLocalDate} (Africa/Johannesburg)
              </p>
            ) : null}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                gap: 12,
              }}
            >
              <StatCard label="Total Employees" value={totalEmployees} />
              <StatCard
                label="Total Active Employees"
                value={Number(dayCounts.totalActiveEmployees || activeEmployees)}
              />
              <StatCard label="Clocked In" value={Number(dayCounts.clockedIn || 0)} />
              <StatCard label="Clocked Out" value={Number(dayCounts.clockedOut || 0)} />
              <StatCard label="Not Clocked In" value={Number(dayCounts.notClockedIn || 0)} />
              <StatCard label="Open Shifts" value={Number(dayCounts.openShifts || 0)} />
              <StatCard label="Exceptions" value={Number(dayCounts.exceptions || 0)} />
              <StatCard label="Ready for EduClock" value={readyToActivate} />
            </div>

            <PreparationProgress
              ready={readyCombined}
              total={totalEmployees}
              needingPrep={needingPrep}
            />

            <div style={{ ...cardStyle, marginTop: 16 }}>
              <div style={{ fontWeight: 800, marginBottom: 12 }}>Preparation summary</div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
                  gap: 10,
                }}
              >
                {[
                  ["Ready", readyToActivate],
                  ["Missing Employee Number", Number(counts.missingEmployeeNumber || 0)],
                  ["Missing User Link", missingUserLink],
                  ["Missing Identity Verification", Number(counts.missingIdentityDocument || 0)],
                  ["Invalid Identity", Number(counts.invalidIdentityDocument || 0)],
                  ["Active Employees", activeEmployees],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>{label}</div>
                    <div style={{ fontSize: 22, fontWeight: 800 }}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "staff" && (
          <EduClockOwnerStaffPage
            embedded
            readinessCache={readinessCache}
            onReadinessUpdated={handleReadinessUpdated}
          />
        )}

        {tab === "attendance" && (
          <EduClockAttendanceTab
            emptyTitle="No attendance yet."
            emptyBody="Attendance will appear once staff begin clocking in."
          />
        )}

        {tab === "exceptions" && (
          <EduClockExceptionsTab
            emptyTitle="No attendance exceptions."
            emptyBody="Exceptions will appear automatically when required."
          />
        )}

        {tab === "geofences" && <EduClockGeofencesTab />}

        {tab === "reports" && (
          <div>
            <EmptyState
              title="Reports will become available after attendance data has been collected."
              body="Report options below are placeholders until Excel and payroll export are enabled."
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                gap: 10,
                marginTop: 12,
              }}
            >
              {REPORT_PLACEHOLDERS.map((label) => (
                <button
                  key={label}
                  type="button"
                  disabled
                  style={{
                    ...disabledCardStyle,
                    textAlign: "left",
                    cursor: "not-allowed",
                    fontWeight: 700,
                  }}
                >
                  {label}
                  <div style={{ fontSize: 11, fontWeight: 500, marginTop: 6 }}>Coming later</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {tab === "settings" && (
          <div style={{ display: "grid", gap: 14, maxWidth: 760 }}>
            <SettingsGroup title="General">
              <div style={{ fontWeight: 700 }}>Owner EduClock control centre</div>
              <div style={{ color: "#64748b", marginTop: 4, fontSize: 13, lineHeight: 1.5 }}>
                Manage readiness, attendance, and campuses for this school only.
              </div>
            </SettingsGroup>
            <SettingsGroup title="Activation">
              <ul style={{ margin: 0, paddingLeft: 18, color: "#475569", lineHeight: 1.6 }}>
                <li>Active Employee</li>
                <li>Employee Number</li>
                <li>Valid Identity Document</li>
                <li>Linked User Account</li>
              </ul>
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
                Ready: {readyToActivate} · Activated: {alreadyActivated} · Total: {totalEmployees}
              </div>
            </SettingsGroup>
            <SettingsGroup title="Clocking">
              <div style={{ color: "#64748b", fontSize: 13, lineHeight: 1.5 }}>
                Staff clock on <code>/educlock</code>. Official timestamps are created by the server.
                One open shift per employee. No GPS validation in this build.
              </div>
            </SettingsGroup>
            <SettingsGroup title="Timezone">
              <div style={{ fontWeight: 700 }}>Africa/Johannesburg</div>
              <div style={{ color: "#64748b", marginTop: 4, fontSize: 13, lineHeight: 1.5 }}>
                School-local attendance dates use this timezone. Device timezone is ignored for
                saved events.
              </div>
            </SettingsGroup>
            <SettingsGroup title="Future GPS">
              <div style={{ color: "#64748b", fontSize: 13, lineHeight: 1.5 }}>
                Campus polygon perimeters, entrances, and location validation will be configured in
                the GPS build. Default tolerance remains 4 metres.
              </div>
            </SettingsGroup>
            <SettingsGroup title="Future Payroll">
              <div style={{ color: "#64748b", fontSize: 13, lineHeight: 1.5 }}>
                Attendance duration is informational only. Payroll run calculations and overtime are
                unchanged and not exported yet.
              </div>
            </SettingsGroup>
          </div>
        )}
      </div>
    </div>
  );
}
