import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { apiFetch, API_URL } from "./api";
import "./Classrooms.css";

function clampPage(page: number, totalPages: number): number {
  const tp = Math.max(1, totalPages);
  const p = Math.trunc(Number(page) || 1);
  return Math.min(tp, Math.max(1, p));
}

function SimplePagination({
  page,
  totalPages,
  onPageChange,
  variant = "inline",
  totalItems,
  pageSize,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  variant?: "inline" | "footer";
  totalItems?: number;
  pageSize?: number;
}) {
  const safePage = clampPage(page, totalPages);
  const tp = Math.max(1, totalPages);
  const total = Math.max(0, Number(totalItems) || 0);
  const size = Math.max(1, Number(pageSize) || 10);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * size + 1;
  const rangeEnd = total === 0 ? 0 : Math.min(safePage * size, total);

  if (variant === "footer") {
    return (
      <div className="classrooms-pagination">
        <span className="classrooms-pagination-meta">
          {total === 0 ? "0" : `${rangeStart} - ${rangeEnd}`} / {total}
        </span>
        <div className="classrooms-pagination-controls">
          <button
            type="button"
            className="ec-page-btn"
            disabled={safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
            aria-label="Previous page"
          >
            ‹
          </button>
          <span className="classrooms-pagination-page-label">
            Page {safePage} / {tp}
          </span>
          <button
            type="button"
            className="ec-page-btn"
            disabled={safePage >= tp}
            onClick={() => onPageChange(safePage + 1)}
            aria-label="Next page"
          >
            ›
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        marginTop: 14,
        flexWrap: "wrap",
      }}
    >
      <button
        type="button"
        className="ec-page-btn"
        disabled={safePage <= 1}
        onClick={() => onPageChange(safePage - 1)}
      >
        Previous
      </button>
      <span style={{ fontWeight: 800, color: "#475569", fontSize: 13 }}>
        Page {safePage} of {tp}
      </span>
      <button
        type="button"
        className="ec-page-btn"
        disabled={safePage >= tp}
        onClick={() => onPageChange(safePage + 1)}
      >
        Next
      </button>
    </div>
  );
}

type ClassroomListRow = {
  id: string;
  name: string;
  teacher: string;
  teacherEmail: string;
  childrenCount: number;
  children?: ChildRow[];
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
  notes: string;
  registered?: boolean;
};

type ClassroomDetail = {
  id: string;
  name: string;
  teacher: string;
  teacherEmail: string;
  minAgeMonths: number | null;
  maxAgeMonths: number | null;
  notes: string;
};

type ClassroomForm = {
  id: string;
  name: string;
  teacher: string;
  teacherEmail: string;
  minAgeYears: number;
  minAgeMonths: number;
  maxAgeYears: number;
  maxAgeMonths: number;
  notes: string;
};

type ChildRow = {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string | null;
  grade: string;
  admissionNo: string | null;
};

type LearnerRow = {
  id: string;
  firstName: string;
  lastName: string;
  grade: string;
  classroomId: string | null;
  birthDate: string | null;
};

function monthsToParts(total: number | null): { years: number; months: number } {
  if (total == null || !Number.isFinite(total)) return { years: 0, months: 0 };
  const t = Math.max(0, Math.trunc(total));
  return { years: Math.floor(t / 12), months: t % 12 };
}

function partsToMonths(years: number, months: number) {
  const y = Math.max(0, Math.trunc(Number(years) || 0));
  const m = Math.min(11, Math.max(0, Math.trunc(Number(months) || 0)));
  return y * 12 + m;
}

function formatAge(birthDateIso: string | null) {
  if (!birthDateIso) return "—";
  const d = new Date(String(birthDateIso));
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  let months =
    (now.getFullYear() - d.getFullYear()) * 12 +
    (now.getMonth() - d.getMonth()) +
    (now.getDate() >= d.getDate() ? 0 : -1);
  months = Math.max(0, months);
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `${y}y ${m}m`;
}

function premiumCardStyle(): CSSProperties {
  return {
    background: "#ffffff",
    borderRadius: 18,
    border: "1px solid rgba(15, 23, 42, 0.10)",
    boxShadow: "0 18px 48px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.8)",
  };
}

function fieldLabelStyle(): CSSProperties {
  return { fontWeight: 900, color: "#0f172a", fontSize: 12, letterSpacing: "0.02em" };
}

function inputStyle(): CSSProperties {
  return {
    width: "100%",
    height: 40,
    borderRadius: 10,
    border: "1px solid rgba(15, 23, 42, 0.14)",
    padding: "0 12px",
    fontWeight: 700,
    outline: "none",
  };
}

export default function Classrooms({
  schoolId,
  onAddLearnerToClassroom,
  onManageLearner,
}: {
  schoolId: string;
  onAddLearnerToClassroom: (classroomName: string) => void;
  onManageLearner: (learnerId: string) => void;
}) {
  const pageSize = 10;

  const [view, setView] = useState<"list" | "manage">("list");
  const [message, setMessage] = useState<string | null>(null);

  const [classrooms, setClassrooms] = useState<ClassroomListRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [managedClassroom, setManagedClassroom] = useState<ClassroomListRow | null>(null);
  const [form, setForm] = useState<ClassroomForm>({
    id: "",
    name: "",
    teacher: "",
    teacherEmail: "",
    minAgeYears: 0,
    minAgeMonths: 0,
    maxAgeYears: 0,
    maxAgeMonths: 0,
    notes: "",
  });
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [childrenCount, setChildrenCount] = useState<number>(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addTeacher, setAddTeacher] = useState("");
  const [addTeacherEmail, setAddTeacherEmail] = useState("");
  const [repairLoading, setRepairLoading] = useState(false);

  const unregisteredCount = useMemo(
    () => classrooms.filter((c) => c.registered === false).length,
    [classrooms]
  );

  useEffect(() => {
    console.log("MANAGE FORM", form);
  }, [form]);

  useEffect(() => {
    console.log("MANAGE CHILDREN", children);
  }, [children]);

  const normalizeChildren = (arr: any[]): ChildRow[] => {
    if (!Array.isArray(arr)) return [];
    return arr
      .map((k: any) => ({
        id: String(k?.id ?? ""),
        firstName: String(k?.firstName ?? ""),
        lastName: String(k?.lastName ?? ""),
        birthDate: k?.birthDate ? String(k.birthDate) : null,
        grade: String(k?.grade ?? ""),
        admissionNo: k?.admissionNo ? String(k.admissionNo) : null,
      }))
      .filter((k) => k.id && (k.firstName || k.lastName));
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return classrooms;
    return classrooms.filter((c) => {
      const name = String(c.name || "").toLowerCase();
      const teacher = String(c.teacher || "").toLowerCase();
      return name.includes(q) || teacher.includes(q);
    });
  }, [classrooms, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = clampPage(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, (safePage - 1) * pageSize + pageSize);

  useEffect(() => {
    setPage(1);
  }, [search]);

  const loadList = async () => {
    if (!schoolId) return;
    setLoadingList(true);
    setMessage(null);
    try {
      const data = await apiFetch(`/api/classrooms?schoolId=${encodeURIComponent(schoolId)}`);
      const response = { data: Array.isArray(data?.classrooms) ? (data.classrooms as any[]) : [] };
      const normalized: ClassroomListRow[] = response.data.map((c: any) => ({
        id: c.id,
        name:
          c?.name && String(c.name).trim() !== String(c.id).trim()
            ? String(c.name).trim()
            : (() => {
                const v = String(c?.className ?? "").trim();
                if (!v) console.log("CLASSROOM RAW:", c);
                return v;
              })(),
        teacher: c.teacher || c.teacherName || "",
        teacherEmail: String(c.teacherEmail || "").trim().toLowerCase(),
        children: c.learners || c.children || [],
        childrenCount: c.childrenCount ?? (c.learners?.length || 0),
        minAgeMonths: c.minAgeMonths ?? null,
        maxAgeMonths: c.maxAgeMonths ?? null,
        notes: c.notes ?? "",
        registered: c.registered !== false,
      }));
      setClassrooms(normalized);

      if (import.meta.env.DEV) {
        const childrenSum = normalized.reduce(
          (sum, row) => sum + Number(row.childrenCount || 0),
          0
        );
        console.info("[EduClear Dev] Classrooms API", {
          schoolId,
          apiUrl: API_URL,
          classroomsCount: normalized.length,
          learnersInClassroomsSum: childrenSum,
          endpoint: `${API_URL}/api/classrooms?schoolId=${encodeURIComponent(schoolId)}`,
        });
      }
    } catch (e: any) {
      setMessage(e?.message || "Failed to load classrooms.");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    void loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const createClassroomRecord = async (row: ClassroomListRow) => {
    if (!schoolId || !row.name) return;
    try {
      setMessage(null);
      const created = await apiFetch(`/api/classrooms`, {
        method: "POST",
        body: JSON.stringify({
          schoolId,
          name: row.name.trim(),
          teacher: row.teacher?.trim() || "",
          teacherName: row.teacher?.trim() || "",
          teacherEmail: String(row.teacherEmail || "").trim().toLowerCase(),
        }),
      });
      if (!created?.success) {
        throw new Error(created?.error || "Failed to create classroom record.");
      }
      await loadList();
      const newId = String(created?.classroom?.id || "");
      if (newId) setSelectedId(newId);
      setMessage(`Classroom record created for "${row.name}".`);
    } catch (e: any) {
      setMessage(e?.message || "Failed to create classroom record.");
    }
  };

  const bulkCreateMissingRecords = async () => {
    if (!schoolId) return;
    setRepairLoading(true);
    setMessage(null);
    try {
      const result = await apiFetch(`/api/classrooms/bulk-create-missing`, {
        method: "POST",
        body: JSON.stringify({ schoolId }),
      });
      if (!result?.success) {
        throw new Error(result?.error || "Bulk create failed.");
      }
      await loadList();
      const n = Number(result?.created ?? 0);
      setMessage(n > 0 ? `Created ${n} missing classroom record(s).` : "All learner classes already have classroom records.");
    } catch (e: any) {
      setMessage(e?.message || "Failed to create missing classroom records.");
    } finally {
      setRepairLoading(false);
    }
  };

  const repairClassroomsAndThreads = async () => {
    if (!schoolId) return;
    setRepairLoading(true);
    setMessage(null);
    try {
      const result = await apiFetch(`/api/classrooms/repair-missing`, {
        method: "POST",
        body: JSON.stringify({ schoolId }),
      });
      if (!result?.success) {
        throw new Error(result?.error || "Repair failed.");
      }
      await loadList();
      const created = Number(result?.classrooms?.created ?? 0);
      const threadsUpdated = Number(result?.threads?.updated ?? 0);
      setMessage(
        `Repair complete: ${created} classroom(s) created, ${threadsUpdated} parent thread(s) re-synced.`
      );
    } catch (e: any) {
      setMessage(e?.message || "Repair failed.");
    } finally {
      setRepairLoading(false);
    }
  };

  const onManage = () => {
    if (!selectedId) {
      setMessage("Please select a classroom first.");
      return;
    }
    const selected = classrooms.find((c) => c.id === selectedId);
    if (!selected) {
      setMessage("Please select a classroom first.");
      return;
    }
    if (selected.registered === false) {
      setMessage(`"${selected.name}" is an unregistered classroom. Create a classroom record first.`);
      return;
    }
    console.log("MANAGE SELECTED", selected);
    setManagedClassroom(selected);

    const minParts = monthsToParts((selected as any)?.minAgeMonths ?? selected.minAgeMonths ?? null);
    const maxParts = monthsToParts((selected as any)?.maxAgeMonths ?? selected.maxAgeMonths ?? null);

    setForm({
      id: selected.id,
      name: selected.name ?? "",
      teacher: selected.teacher ?? "",
      teacherEmail: selected.teacherEmail ?? "",
      minAgeYears: (selected as any)?.minAgeYears ?? minParts.years ?? 0,
      minAgeMonths: (selected as any)?.minAgeMonths ?? minParts.months ?? 0,
      maxAgeYears: (selected as any)?.maxAgeYears ?? maxParts.years ?? 0,
      maxAgeMonths: (selected as any)?.maxAgeMonths ?? maxParts.months ?? 0,
      notes: selected.notes ?? "",
    });

    const selectedChildrenRaw =
      (selected as any)?.learners ??
      (selected as any)?.children ??
      (selected as any)?.classLearners ??
      [];
    const selectedChildren = normalizeChildren(selectedChildrenRaw);
    setChildren(selectedChildren);
    setChildrenCount(
      Number(
        (selected as any)?.childrenCount ??
          (selected as any)?.learners?.length ??
          (selected as any)?.children?.length ??
          selectedChildren.length ??
          0
      ) || 0
    );
    setView("manage");
    setMessage(null);
  };

  const onCreate = async () => {
    const name = addName.trim();
    if (!name) {
      setMessage("Please enter a classroom name.");
      return;
    }
    try {
      setMessage(null);
      const created = await apiFetch(`/api/classrooms`, {
        method: "POST",
        body: JSON.stringify({
          schoolId,
          name,
          teacher: addTeacher.trim(),
          teacherName: addTeacher.trim(),
          teacherEmail: addTeacherEmail.trim().toLowerCase(),
        }),
      });
      if (!created?.success) {
        throw new Error(created?.error || "Failed to create classroom.");
      }
      setAddOpen(false);
      setAddName("");
      setAddTeacher("");
      setAddTeacherEmail("");
      // Reload list and select the created classroom.
      const data = await apiFetch(`/api/classrooms?schoolId=${encodeURIComponent(schoolId)}`);
      const response = { data: Array.isArray(data?.classrooms) ? (data.classrooms as any[]) : [] };
      const normalized: ClassroomListRow[] = response.data.map((c: any) => ({
        id: c.id,
        name:
          c?.name && String(c.name).trim() !== String(c.id).trim()
            ? String(c.name).trim()
            : (() => {
                const v = String(c?.className ?? "").trim();
                if (!v) console.log("CLASSROOM RAW:", c);
                return v;
              })(),
        teacher: c.teacher || c.teacherName || "",
        teacherEmail: String(c.teacherEmail || "").trim().toLowerCase(),
        children: c.learners || c.children || [],
        childrenCount: c.childrenCount ?? (c.learners?.length || 0),
        minAgeMonths: c.minAgeMonths ?? null,
        maxAgeMonths: c.maxAgeMonths ?? null,
        notes: c.notes ?? "",
        registered: c.registered !== false,
      }));
      setClassrooms(normalized);
      const createdRow = normalized.find((c) => c.name === name);
      if (createdRow?.id) setSelectedId(createdRow.id);
      setMessage("Classroom created.");
    } catch (e: any) {
      setMessage(e?.message || "Failed to create classroom.");
    }
  };

  if (view === "manage") {
    const selected = managedClassroom ?? classrooms.find((c) => c.id === selectedId) ?? null;
    return (
      <ClassroomManage
        schoolId={schoolId}
        classroomId={form.id || selectedId}
        initialClassroom={selected}
        classroomForm={form}
        setClassroomForm={setForm}
        children={children}
        setChildren={setChildren}
        childrenCount={childrenCount}
        setChildrenCount={setChildrenCount}
        onBack={async () => {
          setView("list");
          await loadList();
        }}
        onAddLearner={() => onAddLearnerToClassroom(selected?.name ?? "")}
        onManageLearner={(id) => onManageLearner(id)}
        onRefreshList={loadList}
        availableClassrooms={classrooms.map((c) => ({ id: c.id, name: c.name }))}
      />
    );
  }

  return (
    <div className="classrooms-page">
      <div className="classrooms-page-header">
        <h1 className="classrooms-page-title">Classrooms</h1>
        <p className="classrooms-page-subtitle">Manage your classrooms</p>
        <div className="classrooms-page-underline" />
      </div>

      {message ? <div className="classrooms-message">{message}</div> : null}

      <div className="classrooms-panel">
        <div className="classrooms-panel-heading">Classrooms</div>

        <div className="classrooms-toolbar">
          <button
            type="button"
            onClick={() => {
              setAddOpen(true);
              setMessage(null);
            }}
            className="ec-page-btn ec-page-btn--gold"
          >
            + Add
          </button>
          <button type="button" onClick={onManage} className="ec-page-btn">
            ✎ Manage
          </button>
          {unregisteredCount > 0 ? (
            <button
              type="button"
              className="ec-page-btn"
              disabled={repairLoading}
              onClick={() => void bulkCreateMissingRecords()}
            >
              Create missing classroom records ({unregisteredCount})
            </button>
          ) : null}
          <button
            type="button"
            className="ec-page-btn"
            disabled={repairLoading}
            onClick={() => void repairClassroomsAndThreads()}
            title="Rebuild missing classrooms from learner classes and re-sync parent message threads"
          >
            Repair classes &amp; threads
          </button>

          <div className="classrooms-toolbar-spacer" />

          <div className="classrooms-search-wrap">
            <span className="classrooms-search-label">Search</span>
            <input
              className="classrooms-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or teacher…"
            />
          </div>
        </div>

        <div className="ec-table-wrap">
          <table className="ec-table">
            <thead>
              <tr>
                <th style={{ width: "42%" }}>Name</th>
                <th>Teacher</th>
                <th style={{ width: 120 }}>Children</th>
                <th style={{ width: 200 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loadingList ? (
                <tr>
                  <td colSpan={4} style={{ padding: 18, fontWeight: 800 }}>
                    Loading classrooms…
                  </td>
                </tr>
              ) : pageRows.length ? (
                pageRows.map((c, index) => (
                  <tr
                    key={c.id}
                    className={[
                      "table-row",
                      index % 2 === 0 ? "row-white" : "row-gold",
                      selectedId === c.id ? "selected-row" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => {
                      setSelectedId(c.id);
                      setManagedClassroom(c);
                      setMessage(null);
                    }}
                  >
                    <td style={{ fontWeight: 900 }}>
                      {c.name}
                      {c.registered === false ? (
                        <span
                          style={{
                            display: "inline-block",
                            marginLeft: 8,
                            fontSize: 11,
                            fontWeight: 800,
                            color: "#92400e",
                            background: "rgba(212, 175, 55, 0.25)",
                            padding: "2px 8px",
                            borderRadius: 999,
                          }}
                        >
                          unregistered classroom
                        </span>
                      ) : null}
                    </td>
                    <td>{c.teacher || "—"}</td>
                    <td style={{ fontWeight: 900 }}>{c.childrenCount}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {c.registered === false ? (
                        <button
                          type="button"
                          className="ec-page-btn ec-page-btn--compact"
                          onClick={() => void createClassroomRecord(c)}
                        >
                          Create classroom record
                        </button>
                      ) : (
                        <span style={{ color: "#64748b", fontWeight: 700, fontSize: 12 }}>Registered</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} style={{ padding: 18, fontWeight: 800 }}>
                    No classrooms found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <SimplePagination
          variant="footer"
          page={safePage}
          totalPages={totalPages}
          totalItems={filtered.length}
          pageSize={pageSize}
          onPageChange={setPage}
        />
      </div>

      {addOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
            zIndex: 50,
          }}
          onMouseDown={() => setAddOpen(false)}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "min(720px, 100%)",
              ...premiumCardStyle(),
              border: "1px solid rgba(212,175,55,0.22)",
              padding: 18,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 18, color: "#0f172a" }}>New classroom</div>
                <div style={{ marginTop: 6, fontWeight: 700, fontSize: 13, color: "#64748b" }}>
                  Add a classroom (learners will be linked via their Class field)
                </div>
                <div style={{ height: 3, width: 70, background: "linear-gradient(90deg, #d4af37, rgba(212,175,55,0.08))", marginTop: 10, borderRadius: 999 }} />
              </div>
              <button type="button" className="ec-page-btn" onClick={() => setAddOpen(false)}>
                Close
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
              <div>
                <div style={fieldLabelStyle()}>Name</div>
                <input value={addName} onChange={(e) => setAddName(e.target.value)} style={inputStyle()} placeholder="e.g. Penguins" />
              </div>
              <div>
                <div style={fieldLabelStyle()}>Teacher</div>
                <input value={addTeacher} onChange={(e) => setAddTeacher(e.target.value)} style={inputStyle()} placeholder="Teacher name" />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <div style={fieldLabelStyle()}>Class teacher email</div>
                <input
                  value={addTeacherEmail}
                  onChange={(e) => setAddTeacherEmail(e.target.value)}
                  style={inputStyle()}
                  placeholder="teacher@school.com"
                  type="email"
                  autoComplete="email"
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button type="button" className="ec-page-btn" onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button type="button" className="ec-page-btn ec-page-btn--gold" onClick={onCreate}>
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ClassroomManage(props: {
  schoolId: string;
  classroomId: string;
  initialClassroom: ClassroomListRow | null;
  classroomForm: ClassroomForm;
  setClassroomForm: (next: ClassroomForm) => void;
  children: ChildRow[];
  setChildren: (next: ChildRow[]) => void;
  childrenCount: number;
  setChildrenCount: (next: number) => void;
  onBack: () => void | Promise<void>;
  onAddLearner: () => void;
  onManageLearner: (learnerId: string) => void;
  onRefreshList: () => Promise<void>;
  availableClassrooms: Array<{ id: string; name: string }>;
}) {
  const pageSize = 10;
  const form = props.classroomForm;
  const classroomChildren = props.children;

  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);

  const [classroom, setClassroom] = useState<ClassroomDetail | null>(
    props.initialClassroom
      ? {
          id: props.initialClassroom.id,
          name: props.initialClassroom.name,
          teacher: props.initialClassroom.teacher ?? "",
          teacherEmail: props.initialClassroom.teacherEmail ?? "",
          minAgeMonths: props.initialClassroom.minAgeMonths ?? null,
          maxAgeMonths: props.initialClassroom.maxAgeMonths ?? null,
          notes: props.initialClassroom.notes ?? "",
        }
      : null
  );
  const [childPage, setChildPage] = useState(1);
  const [selectedChildIds, setSelectedChildIds] = useState<Set<string>>(new Set());

  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addSearch, setAddSearch] = useState("");
  const [addCandidates, setAddCandidates] = useState<LearnerRow[]>([]);
  const [addSelectedIds, setAddSelectedIds] = useState<Set<string>>(new Set());
  const [addPage, setAddPage] = useState(1);
  const [addError, setAddError] = useState<string | null>(null);

  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTo, setMoveTo] = useState("");

  type CoTeacherRow = { teacherEmail: string; teacherName: string; role: string };
  const [coTeachers, setCoTeachers] = useState<CoTeacherRow[]>([]);
  const [coDraftEmail, setCoDraftEmail] = useState("");
  const [coDraftName, setCoDraftName] = useState("");
  const [coDraftRole, setCoDraftRole] = useState("CO_TEACHER");
  const [coTeachersSaving, setCoTeachersSaving] = useState(false);

  const menuWrapRef = useRef<HTMLDivElement | null>(null);

  type EmailPreview = {
    classroomName: string;
    learnerCount: number;
    parentEmailCount: number;
    learnersWithoutEmail: Array<{ id: string; name: string }>;
  };

  type EmailSendSummary = {
    sentCount: number;
    failedCount: number;
    missingEmailCount: number;
    errors: Array<{ learnerId: string; learnerName: string; reason: string }>;
  };

  const [emailAllOpen, setEmailAllOpen] = useState(false);
  const [emailAllPreview, setEmailAllPreview] = useState<EmailPreview | null>(null);
  const [emailAllPreviewLoading, setEmailAllPreviewLoading] = useState(false);
  const [emailAllSending, setEmailAllSending] = useState(false);
  const [emailAllResult, setEmailAllResult] = useState<EmailSendSummary | null>(null);
  const [emailSingleSending, setEmailSingleSending] = useState(false);
  const emailSendTokenRef = useRef(0);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!menuWrapRef.current) return;
      if (!menuWrapRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const load = async () => {
    if (!props.schoolId || !props.classroomId) return;
    setLoading(true);
    setMessage(null);
    try {
      const data = await apiFetch(
        `/api/classrooms/${encodeURIComponent(props.classroomId)}?schoolId=${encodeURIComponent(props.schoolId)}`
      );
      const c: ClassroomDetail | null = data?.classroom
        ? ({
            id: String(data.classroom?.id ?? ""),
            name: String(data.classroom?.name ?? ""),
            teacher: String(data.classroom?.teacher ?? data.classroom?.teacherName ?? ""),
            teacherEmail: String(data.classroom?.teacherEmail ?? ""),
            minAgeMonths: data.classroom?.minAgeMonths ?? null,
            maxAgeMonths: data.classroom?.maxAgeMonths ?? null,
            notes: String(data.classroom?.notes ?? ""),
          } as ClassroomDetail)
        : data?.id
          ? ({
              id: String(data?.id ?? ""),
              name: String(data?.name ?? ""),
              teacher: String(data?.teacher ?? data?.teacherName ?? ""),
              teacherEmail: String(data?.teacherEmail ?? ""),
              minAgeMonths:
                typeof data?.minAgeYears === "number" || typeof data?.minAgeMonths === "number"
                  ? partsToMonths(Number(data?.minAgeYears || 0), Number(data?.minAgeMonths || 0))
                  : null,
              maxAgeMonths:
                typeof data?.maxAgeYears === "number" || typeof data?.maxAgeMonths === "number"
                  ? partsToMonths(Number(data?.maxAgeYears || 0), Number(data?.maxAgeMonths || 0))
                  : null,
              notes: String(data?.notes ?? ""),
            } as ClassroomDetail)
          : null;

      const learnersRaw = Array.isArray(data?.learners)
        ? (data.learners as any[])
        : Array.isArray(data?.children)
          ? (data.children as any[])
          : [];

      console.log("Loaded classroom for manage:", c);
      if (c) setClassroom(c);

      try {
        const teachersData = await apiFetch(
          `/api/classrooms/${encodeURIComponent(props.classroomId)}/teachers?schoolId=${encodeURIComponent(props.schoolId)}`
        );
        const rows = Array.isArray(teachersData?.teachers) ? teachersData.teachers : [];
        setCoTeachers(
          rows.map((t: { teacherEmail?: string; teacherName?: string; role?: string }) => ({
            teacherEmail: String(t.teacherEmail || "").trim().toLowerCase(),
            teacherName: String(t.teacherName || "").trim(),
            role: String(t.role || "CO_TEACHER").toUpperCase(),
          }))
        );
      } catch {
        setCoTeachers([]);
      }

      if (c) {
        const apiTeacher = String(c?.teacher ?? (c as { teacherName?: string })?.teacherName ?? "").trim();
        const apiTeacherEmail = String(c?.teacherEmail ?? "").trim().toLowerCase();
        const apiNotes = String(c?.notes ?? "");

        const merged: ClassroomForm = { ...props.classroomForm };
        merged.id = String(c?.id ?? merged.id ?? props.classroomId ?? "").trim();
        const safeName = String(c?.name ?? "").trim();

        const isIdLike =
          safeName.length > 20 &&
          !safeName.includes(" ") &&
          /^[a-z0-9]+$/i.test(safeName);
        if (!isIdLike && safeName) {
          merged.name = safeName;
        }
        merged.teacher = apiTeacher;
        merged.teacherEmail = apiTeacherEmail;
        if (String(apiNotes).trim()) merged.notes = apiNotes;

        if (c.minAgeMonths != null) {
          const min = monthsToParts(c.minAgeMonths);
          merged.minAgeYears = min.years;
          merged.minAgeMonths = min.months;
        }
        if (c.maxAgeMonths != null) {
          const max = monthsToParts(c.maxAgeMonths);
          merged.maxAgeYears = max.years;
          merged.maxAgeMonths = max.months;
        }

        console.log("BEFORE SET FORM:", merged);
        const selected = c;
        const finalMerged: ClassroomForm = {
          ...merged,
          name:
            merged?.name &&
            merged.name.trim() &&
            merged.name !== merged.id &&
            merged.name.length < 30
              ? merged.name
              : (selected?.name || ""),
        };
        if (finalMerged?.name && finalMerged?.id && finalMerged.name === finalMerged.id) {
          console.error("INVALID NAME SOURCE");
        }
        console.log("FINAL SET FORM:", finalMerged);
        props.setClassroomForm(finalMerged);
      }

      if (learnersRaw.length) {
        props.setChildren(
          learnersRaw.map((k) => ({
            id: String(k?.id ?? ""),
            firstName: String(k?.firstName ?? ""),
            lastName: String(k?.lastName ?? ""),
            birthDate: k?.birthDate ? String(k.birthDate) : null,
            grade: String(k?.grade ?? ""),
            admissionNo: k?.admissionNo ? String(k.admissionNo) : null,
          }))
        );
        props.setChildrenCount(Number(data?.childrenCount ?? learnersRaw.length) || 0);
      }

      setSelectedChildIds(new Set());
      setChildPage(1);
    } catch (e: any) {
      setMessage(e?.message || "Failed to load classroom.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.schoolId, props.classroomId]);

  const childTotalPages = Math.max(1, Math.ceil(classroomChildren.length / pageSize));
  const safeChildPage = clampPage(childPage, childTotalPages);
  const childRows = classroomChildren.slice((safeChildPage - 1) * pageSize, (safeChildPage - 1) * pageSize + pageSize);

  const allOnPageSelected = childRows.length > 0 && childRows.every((r) => selectedChildIds.has(r.id));

  const toggleAllOnPage = () => {
    const next = new Set(selectedChildIds);
    if (allOnPageSelected) {
      for (const r of childRows) next.delete(r.id);
    } else {
      for (const r of childRows) next.add(r.id);
    }
    setSelectedChildIds(next);
  };

  const toggleChild = (id: string) => {
    const next = new Set(selectedChildIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedChildIds(next);
  };

  const openAddModal = async () => {
    setAddOpen(true);
    setAddSearch("");
    setAddCandidates([]);
    setAddSelectedIds(new Set());
    setAddPage(1);
    setAddError(null);
    setMessage(null);
    try {
      setAddLoading(true);
      const data = await apiFetch(`/api/learners?schoolId=${encodeURIComponent(props.schoolId)}`);
      const list = Array.isArray(data?.learners) ? (data.learners as any[]) : [];
      const rows: LearnerRow[] = list
        .map((l) => ({
          id: String(l?.id ?? ""),
          firstName: String(l?.firstName ?? ""),
          lastName: String(l?.lastName ?? ""),
          grade: String(l?.grade ?? ""),
          classroomId: l?.classroomId ? String(l.classroomId) : null,
          birthDate: l?.birthDate ? String(l.birthDate) : null,
        }))
        .filter((l) => l.id && l.firstName && l.lastName)
        // VERY IMPORTANT: only show learners not assigned to ANY classroom
        .filter((l) => !l.classroomId);
      setAddCandidates(rows);
    } catch (e: any) {
      setMessage(e?.message || "Failed to load learners.");
    } finally {
      setAddLoading(false);
    }
  };

  const filteredAddCandidates = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    if (!q) return addCandidates;
    return addCandidates.filter((l) => {
      const name = `${l.firstName} ${l.lastName}`.toLowerCase();
      const gradeText = `${l.grade}`.toLowerCase();
      return name.includes(q) || gradeText.includes(q);
    });
  }, [addCandidates, addSearch]);

  useEffect(() => {
    setAddPage(1);
  }, [addSearch]);

  const addTotalPages = Math.max(1, Math.ceil(filteredAddCandidates.length / pageSize));
  const safeAddPage = clampPage(addPage, addTotalPages);
  const addRows = filteredAddCandidates.slice((safeAddPage - 1) * pageSize, (safeAddPage - 1) * pageSize + pageSize);
  const allAddOnPageSelected = addRows.length > 0 && addRows.every((r) => addSelectedIds.has(r.id));

  const toggleAddAllOnPage = () => {
    const next = new Set(addSelectedIds);
    if (allAddOnPageSelected) {
      for (const r of addRows) next.delete(r.id);
    } else {
      for (const r of addRows) next.add(r.id);
    }
    setAddSelectedIds(next);
  };

  const toggleAddLearner = (id: string) => {
    const next = new Set(addSelectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAddSelectedIds(next);
  };

  const addSelectedLearners = async () => {
    const ids = Array.from(addSelectedIds);
    if (!ids.length) {
      setMessage("Please select at least one learner first.");
      return;
    }
    try {
      setMessage(null);
      setAddError(null);
      // POST /api/classrooms/:id/add-learners
      await apiFetch(`/api/classrooms/${encodeURIComponent(props.classroomId)}/add-learners`, {
        method: "POST",
        body: JSON.stringify({ schoolId: props.schoolId, learnerIds: ids }),
      });
      setAddOpen(false);
      setAddSelectedIds(new Set());
      setAddCandidates((prev) => prev.filter((l) => !ids.includes(l.id)));
      await load();
      await props.onRefreshList();
    } catch (e: any) {
      const msg = e?.message || "Could not add learners to classroom.";
      setAddError("Could not add learners to classroom.");
      setMessage(msg);
    }
  };

  const save = async () => {
    const nextName = String(props.classroomForm.name || "").trim();
    if (!nextName) {
      setMessage("Please enter a classroom name.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const data = await apiFetch(`/api/classrooms/${encodeURIComponent(props.classroomId)}`, {
        method: "PUT",
        body: JSON.stringify({
          schoolId: props.schoolId,
          name: nextName,
          teacher: String(props.classroomForm.teacher ?? "").trim(),
          teacherName: String(props.classroomForm.teacher ?? "").trim(),
          teacherEmail: String(props.classroomForm.teacherEmail ?? "").trim().toLowerCase(),
          minAgeYears: props.classroomForm.minAgeYears,
          minAgeExtraMonths: props.classroomForm.minAgeMonths,
          maxAgeYears: props.classroomForm.maxAgeYears,
          maxAgeExtraMonths: props.classroomForm.maxAgeMonths,
          notes: String(props.classroomForm.notes ?? ""),
        }),
      });
      if (!data?.success) {
        throw new Error(data?.error || "Failed to save classroom.");
      }
      const returned = data?.classroom;
      if (returned?.id) {
        const updated: ClassroomDetail = {
          id: String(returned.id),
          name: String(returned.name ?? nextName),
          teacher: String(returned.teacher ?? returned.teacherName ?? props.classroomForm.teacher ?? ""),
          teacherEmail: String(returned.teacherEmail ?? props.classroomForm.teacherEmail ?? ""),
          minAgeMonths:
            returned.minAgeMonths ??
            partsToMonths(props.classroomForm.minAgeYears, props.classroomForm.minAgeMonths),
          maxAgeMonths:
            returned.maxAgeMonths ??
            partsToMonths(props.classroomForm.maxAgeYears, props.classroomForm.maxAgeMonths),
          notes: String(returned.notes ?? props.classroomForm.notes ?? ""),
        };
        setClassroom(updated);
        const merged: ClassroomForm = {
          ...props.classroomForm,
          id: updated.id,
          name: updated.name,
          teacher: updated.teacher,
          teacherEmail: updated.teacherEmail,
          notes: updated.notes,
        };
        console.log("BEFORE SET FORM:", merged);
        const selected = updated;
        const finalMerged: ClassroomForm = {
          ...merged,
          name:
            merged?.name &&
            merged.name.trim() &&
            merged.name !== merged.id &&
            merged.name.length < 30
              ? merged.name
              : (selected?.name || ""),
        };
        if (finalMerged?.name && finalMerged?.id && finalMerged.name === finalMerged.id) {
          console.error("INVALID NAME SOURCE");
        }
        console.log("FINAL SET FORM:", finalMerged);
        props.setClassroomForm(finalMerged);
      }
      await props.onRefreshList();
      await load();
      await saveCoTeachers();
      setMessage("Classroom saved.");
    } catch (e: any) {
      setMessage(e?.message || "Failed to save classroom.");
    } finally {
      setSaving(false);
    }
  };

  const saveCoTeachers = async () => {
    const primaryEmail = String(props.classroomForm.teacherEmail ?? "").trim().toLowerCase();
    const primaryName = String(props.classroomForm.teacher ?? "").trim();
    const teachers = [
      ...(primaryEmail
        ? [{ teacherEmail: primaryEmail, teacherName: primaryName || "Class Teacher", role: "PRIMARY" }]
        : []),
      ...coTeachers.filter((t) => t.teacherEmail && t.teacherEmail !== primaryEmail),
    ];
    if (!teachers.length) return;
    setCoTeachersSaving(true);
    try {
      await apiFetch(`/api/classrooms/${encodeURIComponent(props.classroomId)}/teachers`, {
        method: "PUT",
        body: JSON.stringify({ schoolId: props.schoolId, teachers }),
      });
    } finally {
      setCoTeachersSaving(false);
    }
  };

  const addCoTeacher = () => {
    const email = coDraftEmail.trim().toLowerCase();
    if (!email) return;
    if (coTeachers.some((t) => t.teacherEmail === email)) return;
    setCoTeachers((prev) => [
      ...prev,
      {
        teacherEmail: email,
        teacherName: coDraftName.trim() || email,
        role: coDraftRole,
      },
    ]);
    setCoDraftEmail("");
    setCoDraftName("");
  };

  const removeCoTeacher = (email: string) => {
    setCoTeachers((prev) => prev.filter((t) => t.teacherEmail !== email));
  };

  const persistCoTeachersOnly = async () => {
    setCoTeachersSaving(true);
    setMessage(null);
    try {
      await saveCoTeachers();
      await load();
      setMessage("Class teachers updated.");
    } catch (e: any) {
      setMessage(e?.message || "Failed to update class teachers.");
    } finally {
      setCoTeachersSaving(false);
    }
  };

  const removeSelected = async () => {
    const ids = Array.from(selectedChildIds);
    if (!ids.length) {
      setMessage("Please select at least one learner to remove.");
      return;
    }
    const ok = window.confirm("Remove selected learners from this classroom? This will not delete learner records.");
    if (!ok) return;
    try {
      setMessage(null);
      await apiFetch(`/api/classrooms/${encodeURIComponent(props.classroomId)}/remove-learners`, {
        method: "POST",
        body: JSON.stringify({ schoolId: props.schoolId, learnerIds: ids }),
      });
      await load();
      await props.onRefreshList();
      setMessage("Learners removed from classroom.");
    } catch (e: any) {
      setMessage(e?.message || "Failed to remove children.");
    }
  };

  const moveSelected = async () => {
    const ids = Array.from(selectedChildIds);
    if (!ids.length) {
      setMessage("Please select at least one learner to move.");
      return;
    }
    setMoveTo("");
    setMoveOpen(true);
  };

  const confirmMove = async () => {
    const ids = Array.from(selectedChildIds);
    const target = moveTo.trim();
    if (!target) {
      setMessage("Please select a classroom to move to.");
      return;
    }
    try {
      setMessage(null);
      await apiFetch(`/api/classrooms/${encodeURIComponent(props.classroomId)}/move-learners`, {
        method: "POST",
        body: JSON.stringify({ schoolId: props.schoolId, learnerIds: ids, targetClassroomId: target }),
      });
      setMoveOpen(false);
      await load();
      await props.onRefreshList();
      setMessage("Learners moved successfully.");
    } catch (e: any) {
      setMessage(e?.message || "Failed to move children.");
    }
  };

  const manageSelectedChild = () => {
    const ids = Array.from(selectedChildIds);
    if (ids.length === 0) {
      setMessage("Please select a learner first.");
      return;
    }
    if (ids.length > 1) {
      setMessage("Please select only one learner to manage.");
      return;
    }
    props.onManageLearner(ids[0]);
  };

  const deleteClassroom = async () => {
    const ok = window.confirm("Delete this classroom? Learners will NOT be deleted; their classroom will be cleared.");
    if (!ok) return;
    try {
      setMessage(null);
      await apiFetch(
        `/api/classrooms/${encodeURIComponent(props.classroomId)}?schoolId=${encodeURIComponent(props.schoolId)}`,
        { method: "DELETE" }
      );
      await props.onRefreshList();
      await props.onBack();
    } catch (e: any) {
      setMessage(e?.message || "Failed to delete classroom.");
    }
  };

  const classroomDisplayName = String(form.name || classroom?.name || "this class").trim() || "this class";

  const openEmailAllModal = async () => {
    setMenuOpen(false);
    setEmailAllResult(null);
    setEmailAllOpen(true);
    setEmailAllPreview(null);
    setEmailAllPreviewLoading(true);
    try {
      const data = await apiFetch(
        `/api/classes/${encodeURIComponent(props.classroomId)}/email-reports/preview?schoolId=${encodeURIComponent(props.schoolId)}`
      );
      setEmailAllPreview({
        classroomName: String(data?.classroomName || classroomDisplayName),
        learnerCount: Number(data?.learnerCount || classroomChildren.length) || 0,
        parentEmailCount: Number(data?.parentEmailCount || 0) || 0,
        learnersWithoutEmail: Array.isArray(data?.learnersWithoutEmail) ? data.learnersWithoutEmail : [],
      });
    } catch (e: any) {
      setEmailAllOpen(false);
      setMessage(e?.message || "Could not load email preview.");
    } finally {
      setEmailAllPreviewLoading(false);
    }
  };

  const confirmEmailAll = async () => {
    if (emailAllSending) return;
    const token = ++emailSendTokenRef.current;
    setEmailAllSending(true);
    setEmailAllResult(null);
    try {
      const data = await apiFetch(
        `/api/classes/${encodeURIComponent(props.classroomId)}/email-reports`,
        {
          method: "POST",
          body: JSON.stringify({
            schoolId: props.schoolId,
            idempotencyKey: `class-all-${props.classroomId}-${token}`,
          }),
        }
      );
      if (emailSendTokenRef.current !== token) return;
      setEmailAllResult({
        sentCount: Number(data?.sentCount || 0) || 0,
        failedCount: Number(data?.failedCount || 0) || 0,
        missingEmailCount: Number(data?.missingEmailCount || 0) || 0,
        errors: Array.isArray(data?.errors) ? data.errors : [],
      });
    } catch (e: any) {
      if (emailSendTokenRef.current !== token) return;
      setMessage(e?.message || "Failed to email reports.");
      setEmailAllOpen(false);
    } finally {
      if (emailSendTokenRef.current === token) setEmailAllSending(false);
    }
  };

  const emailSelectedLearnerReport = async () => {
    setMenuOpen(false);
    const ids = Array.from(selectedChildIds);
    if (ids.length === 0 || ids.length > 1) {
      setMessage("Please select only one learner to send an individual report.");
      return;
    }
    if (emailSingleSending) return;
    const learnerId = ids[0];
    const token = ++emailSendTokenRef.current;
    setEmailSingleSending(true);
    setMessage(null);
    try {
      const data = await apiFetch(
        `/api/classes/${encodeURIComponent(props.classroomId)}/learners/${encodeURIComponent(learnerId)}/email-report`,
        {
          method: "POST",
          body: JSON.stringify({
            schoolId: props.schoolId,
            idempotencyKey: `class-one-${props.classroomId}-${learnerId}-${token}`,
          }),
        }
      );
      const summary: EmailSendSummary = {
        sentCount: Number(data?.sentCount || 0) || 0,
        failedCount: Number(data?.failedCount || 0) || 0,
        missingEmailCount: Number(data?.missingEmailCount || 0) || 0,
        errors: Array.isArray(data?.errors) ? data.errors : [],
      };
      if (summary.sentCount > 0) {
        setMessage(`Report emailed successfully (${summary.sentCount} sent).`);
      } else if (summary.missingEmailCount > 0) {
        setMessage("No parent/guardian email on file for this learner.");
      } else {
        const reason = summary.errors[0]?.reason || "Failed to send report.";
        setMessage(reason);
      }
    } catch (e: any) {
      setMessage(e?.message || "Failed to email report.");
    } finally {
      setEmailSingleSending(false);
    }
  };

  return (
    <div className="classrooms-manage-shell">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="ec-page-btn" onClick={() => props.onBack()}>
            Back
          </button>
          <button type="button" className="ec-page-btn ec-page-btn--gold" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        <div className="classrooms-more-actions-wrap" ref={menuWrapRef}>
          <button
            type="button"
            className="ec-page-btn"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={emailSingleSending}
          >
            More Actions ▾
          </button>
          {menuOpen ? (
            <div className="classrooms-more-actions-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => void openEmailAllModal()}>
                Email reports to all parents
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={emailSingleSending}
                onClick={() => void emailSelectedLearnerReport()}
              >
                {emailSingleSending ? "Sending report…" : "Email report for selected learner"}
              </button>
              <div className="classrooms-more-actions-divider" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  const merged: ClassroomForm = { ...props.classroomForm, teacher: "", teacherEmail: "" };
                  const selected = classroom;
                  const finalMerged: ClassroomForm = {
                    ...merged,
                    name:
                      merged?.name &&
                      merged.name.trim() &&
                      merged.name !== merged.id &&
                      merged.name.length < 30
                        ? merged.name
                        : selected?.name || "",
                  };
                  props.setClassroomForm(finalMerged);
                  setMessage("Teacher cleared. Click Save to persist.");
                }}
              >
                Clear teacher
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  window.open(
                    `${API_URL}/api/classrooms/${encodeURIComponent(props.classroomId)}/export?schoolId=${encodeURIComponent(props.schoolId)}`,
                    "_blank"
                  );
                }}
              >
                Export class list
              </button>
              <div className="classrooms-more-actions-divider" />
              <button
                type="button"
                role="menuitem"
                className="classrooms-more-actions-menu__danger"
                onClick={() => {
                  setMenuOpen(false);
                  void deleteClassroom();
                }}
              >
                Delete classroom
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <h1>{form.name}</h1>
        {loading ? <div style={{ color: "#475569", fontWeight: 800 }}>Loading…</div> : null}
      </div>

      {message ? <div className="classrooms-message" style={{ marginTop: 12 }}>{message}</div> : null}

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 14 }}>
        <div className="classrooms-card classrooms-card--gold-border" style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900, fontSize: 16, color: "#0f172a" }}>Classroom</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 900, fontSize: 12, color: "#0f172a", padding: "6px 10px", borderRadius: 999, background: "rgba(212,175,55,0.14)", border: "1px solid rgba(212,175,55,0.35)" }}>
                General
              </span>
            </div>
          </div>
          <div className="classrooms-section-underline" />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
            <div>
              <div style={fieldLabelStyle()}>Name</div>
              <input
                value={form.name}
                onChange={(e) => {
                  const merged: ClassroomForm = { ...form, name: e.target.value };
                  console.log("BEFORE SET FORM:", merged);
                  const selected = classroom;
                  const finalMerged: ClassroomForm = {
                    ...merged,
                    name:
                      merged?.name &&
                      merged.name.trim() &&
                      merged.name !== merged.id &&
                      merged.name.length < 30
                        ? merged.name
                        : (selected?.name || ""),
                  };
                  if (finalMerged?.name && finalMerged?.id && finalMerged.name === finalMerged.id) {
                    console.error("INVALID NAME SOURCE");
                  }
                  console.log("FINAL SET FORM:", finalMerged);
                  props.setClassroomForm(finalMerged);
                }}
                style={inputStyle()}
              />
            </div>
            <div>
              <div style={fieldLabelStyle()}>Teacher</div>
              <input
                value={props.classroomForm.teacher}
                onChange={(e) => {
                  const merged: ClassroomForm = { ...props.classroomForm, teacher: e.target.value };
                  console.log("BEFORE SET FORM:", merged);
                  const selected = classroom;
                  const finalMerged: ClassroomForm = {
                    ...merged,
                    name:
                      merged?.name &&
                      merged.name.trim() &&
                      merged.name !== merged.id &&
                      merged.name.length < 30
                        ? merged.name
                        : (selected?.name || ""),
                  };
                  if (finalMerged?.name && finalMerged?.id && finalMerged.name === finalMerged.id) {
                    console.error("INVALID NAME SOURCE");
                  }
                  console.log("FINAL SET FORM:", finalMerged);
                  props.setClassroomForm(finalMerged);
                }}
                style={inputStyle()}
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <div style={fieldLabelStyle()}>Class teacher email</div>
              <input
                value={props.classroomForm.teacherEmail}
                onChange={(e) => {
                  const merged: ClassroomForm = { ...props.classroomForm, teacherEmail: e.target.value };
                  console.log("BEFORE SET FORM:", merged);
                  const selected = classroom;
                  const finalMerged: ClassroomForm = {
                    ...merged,
                    name:
                      merged?.name &&
                      merged.name.trim() &&
                      merged.name !== merged.id &&
                      merged.name.length < 30
                        ? merged.name
                        : (selected?.name || ""),
                  };
                  if (finalMerged?.name && finalMerged?.id && finalMerged.name === finalMerged.id) {
                    console.error("INVALID NAME SOURCE");
                  }
                  console.log("FINAL SET FORM:", finalMerged);
                  props.setClassroomForm(finalMerged);
                }}
                style={inputStyle()}
                placeholder="teacher@school.com"
                type="email"
                autoComplete="email"
              />
            </div>

            <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
              <div style={fieldLabelStyle()}>Co-teachers & assistants</div>
              <p style={{ margin: "0 0 10px", fontSize: 12, color: "#64748b", fontWeight: 700 }}>
                Primary teacher uses the name and email above. Add co-teachers who share the learner list and
                attendance; their private work stays separate in the Teacher Portal.
              </p>
              <ul style={{ margin: "0 0 10px", paddingLeft: 18 }}>
                {coTeachers
                  .filter((t) => t.role !== "PRIMARY")
                  .map((t) => (
                    <li key={t.teacherEmail} style={{ marginBottom: 6, fontWeight: 700, color: "#0f172a" }}>
                      {t.teacherName || t.teacherEmail} ({t.role.replace(/_/g, " ").toLowerCase()}) ·{" "}
                      {t.teacherEmail}
                      <button
                        type="button"
                        className="ec-page-btn"
                        style={{ marginLeft: 8 }}
                        onClick={() => removeCoTeacher(t.teacherEmail)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
              </ul>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 140px auto", gap: 8 }}>
                <input
                  value={coDraftName}
                  onChange={(e) => setCoDraftName(e.target.value)}
                  style={inputStyle()}
                  placeholder="Teacher name"
                />
                <input
                  value={coDraftEmail}
                  onChange={(e) => setCoDraftEmail(e.target.value)}
                  style={inputStyle()}
                  placeholder="teacher@school.com"
                  type="email"
                />
                <select value={coDraftRole} onChange={(e) => setCoDraftRole(e.target.value)} style={inputStyle()}>
                  <option value="CO_TEACHER">Co-teacher</option>
                  <option value="ASSISTANT">Assistant</option>
                </select>
                <button type="button" className="ec-page-btn ec-page-btn--gold" onClick={addCoTeacher}>
                  Add
                </button>
              </div>
              <button
                type="button"
                className="ec-page-btn"
                style={{ marginTop: 10 }}
                disabled={coTeachersSaving}
                onClick={() => void persistCoTeachersOnly()}
              >
                {coTeachersSaving ? "Saving teachers…" : "Save class teachers"}
              </button>
            </div>

            <div>
              <div style={fieldLabelStyle()}>Minimum Age</div>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  type="number"
                  value={props.classroomForm.minAgeYears}
                  onChange={(e) => {
                    const merged: ClassroomForm = { ...props.classroomForm, minAgeYears: Number(e.target.value || 0) };
                    console.log("BEFORE SET FORM:", merged);
                    const selected = classroom;
                    const finalMerged: ClassroomForm = {
                      ...merged,
                      name:
                        merged?.name &&
                        merged.name.trim() &&
                        merged.name !== merged.id &&
                        merged.name.length < 30
                          ? merged.name
                          : (selected?.name || ""),
                    };
                    if (finalMerged?.name && finalMerged?.id && finalMerged.name === finalMerged.id) {
                      console.error("INVALID NAME SOURCE");
                    }
                    console.log("FINAL SET FORM:", finalMerged);
                    props.setClassroomForm(finalMerged);
                  }}
                  style={inputStyle()}
                />
                <input
                  type="number"
                  value={props.classroomForm.minAgeMonths}
                  onChange={(e) => {
                    const merged: ClassroomForm = { ...props.classroomForm, minAgeMonths: Number(e.target.value || 0) };
                    console.log("BEFORE SET FORM:", merged);
                    const selected = classroom;
                    const finalMerged: ClassroomForm = {
                      ...merged,
                      name:
                        merged?.name &&
                        merged.name.trim() &&
                        merged.name !== merged.id &&
                        merged.name.length < 30
                          ? merged.name
                          : (selected?.name || ""),
                    };
                    if (finalMerged?.name && finalMerged?.id && finalMerged.name === finalMerged.id) {
                      console.error("INVALID NAME SOURCE");
                    }
                    console.log("FINAL SET FORM:", finalMerged);
                    props.setClassroomForm(finalMerged);
                  }}
                  style={inputStyle()}
                />
              </div>
              <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "#64748b" }}>Years • Months</div>
            </div>

            <div>
              <div style={fieldLabelStyle()}>Maximum Age</div>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  type="number"
                  value={props.classroomForm.maxAgeYears}
                  onChange={(e) => {
                    const merged: ClassroomForm = { ...props.classroomForm, maxAgeYears: Number(e.target.value || 0) };
                    console.log("BEFORE SET FORM:", merged);
                    const selected = classroom;
                    const finalMerged: ClassroomForm = {
                      ...merged,
                      name:
                        merged?.name &&
                        merged.name.trim() &&
                        merged.name !== merged.id &&
                        merged.name.length < 30
                          ? merged.name
                          : (selected?.name || ""),
                    };
                    if (finalMerged?.name && finalMerged?.id && finalMerged.name === finalMerged.id) {
                      console.error("INVALID NAME SOURCE");
                    }
                    console.log("FINAL SET FORM:", finalMerged);
                    props.setClassroomForm(finalMerged);
                  }}
                  style={inputStyle()}
                />
                <input
                  type="number"
                  value={props.classroomForm.maxAgeMonths}
                  onChange={(e) => {
                    const merged: ClassroomForm = { ...props.classroomForm, maxAgeMonths: Number(e.target.value || 0) };
                    console.log("BEFORE SET FORM:", merged);
                    const selected = classroom;
                    const finalMerged: ClassroomForm = {
                      ...merged,
                      name:
                        merged?.name &&
                        merged.name.trim() &&
                        merged.name !== merged.id &&
                        merged.name.length < 30
                          ? merged.name
                          : (selected?.name || ""),
                    };
                    if (finalMerged?.name && finalMerged?.id && finalMerged.name === finalMerged.id) {
                      console.error("INVALID NAME SOURCE");
                    }
                    console.log("FINAL SET FORM:", finalMerged);
                    props.setClassroomForm(finalMerged);
                  }}
                  style={inputStyle()}
                />
              </div>
              <div style={{ marginTop: 6, fontSize: 12, fontWeight: 700, color: "#64748b" }}>Years • Months</div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={fieldLabelStyle()}>Notes</div>
            <textarea
              value={props.classroomForm.notes}
              onChange={(e) => {
                const merged: ClassroomForm = { ...props.classroomForm, notes: e.target.value };
                console.log("BEFORE SET FORM:", merged);
                const selected = classroom;
                const finalMerged: ClassroomForm = {
                  ...merged,
                  name:
                    merged?.name &&
                    merged.name.trim() &&
                    merged.name !== merged.id &&
                    merged.name.length < 30
                      ? merged.name
                      : (selected?.name || ""),
                };
                if (finalMerged?.name && finalMerged?.id && finalMerged.name === finalMerged.id) {
                  console.error("INVALID NAME SOURCE");
                }
                console.log("FINAL SET FORM:", finalMerged);
                props.setClassroomForm(finalMerged);
              }}
              style={{
                width: "100%",
                minHeight: 92,
                borderRadius: 12,
                border: "1px solid rgba(15, 23, 42, 0.14)",
                padding: 12,
                fontWeight: 700,
                outline: "none",
              }}
            />
          </div>
        </div>

        <div className="classrooms-card classrooms-card--gold-border" style={{ padding: 16 }}>
          <div style={{ height: 86, borderRadius: 16, background: "linear-gradient(135deg, rgba(212,175,55,0.18), rgba(15,23,42,0.06))", border: "1px dashed rgba(212,175,55,0.38)" }} />
          <div style={{ marginTop: 12, fontWeight: 900, fontSize: 18, color: "#0f172a" }}>{form.name}</div>
          <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800, fontSize: 13 }}>
            Teacher: {form.teacher || "—"}
          </div>
          <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800, fontSize: 13 }}>
            Email: {form.teacherEmail || "—"}
          </div>
          <div style={{ marginTop: 6, color: "#64748b", fontWeight: 800, fontSize: 13 }}>
            Children: {classroomChildren.length}
          </div>
          <div style={{ marginTop: 10, color: "#0f172a", fontWeight: 800, fontSize: 13 }}>
            {String(form.notes || "").trim() ? form.notes : "—"}
          </div>
        </div>
      </div>

      <div className="classrooms-card classrooms-card--gold-border" style={{ marginTop: 16, padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16, color: "#0f172a" }}>Children</div>
            <div style={{ marginTop: 6, fontWeight: 700, fontSize: 13, color: "#64748b" }}>
              Learners assigned to this classroom
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="ec-page-btn ec-page-btn--gold" onClick={() => void openAddModal()}>
              + Add
            </button>
            <button type="button" className="ec-page-btn" onClick={manageSelectedChild}>
              Manage
            </button>
            <button type="button" className="ec-page-btn" onClick={moveSelected}>
              Move
            </button>
            <button type="button" className="ec-page-btn" onClick={removeSelected}>
              Remove
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12 }} className="ec-table-wrap">
          <table className="ec-table">
            <thead>
              <tr>
                <th style={{ width: 54 }}>
                  <input type="checkbox" checked={allOnPageSelected} onChange={toggleAllOnPage} />
                </th>
                <th>Name</th>
                <th>Surname</th>
                <th style={{ width: 110 }}>Age</th>
                <th style={{ width: 140 }}>Child Status</th>
              </tr>
            </thead>
            <tbody>
              {childRows.length ? (
                childRows.map((r, index) => {
                  const checked = selectedChildIds.has(r.id);
                  return (
                    <tr
                      key={r.id}
                      className={[
                        "table-row",
                        index % 2 === 0 ? "row-white" : "row-gold",
                        checked ? "selected-row" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      onClick={() => toggleChild(r.id)}
                      style={{ cursor: "pointer" }}
                    >
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={checked} onChange={() => toggleChild(r.id)} />
                      </td>
                      <td style={{ fontWeight: 900 }}>{r.firstName}</td>
                      <td>{r.lastName}</td>
                      <td style={{ fontWeight: 900 }}>{formatAge(r.birthDate)}</td>
                      <td>—</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} style={{ padding: 18, fontWeight: 800 }}>
                    No children in this classroom.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <SimplePagination page={safeChildPage} totalPages={childTotalPages} onPageChange={setChildPage} />
      </div>

      {emailAllOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="email-all-reports-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
            zIndex: 80,
          }}
          onMouseDown={() => {
            if (!emailAllSending) setEmailAllOpen(false);
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "min(560px, 100%)",
              ...premiumCardStyle(),
              border: "1px solid rgba(212,175,55,0.22)",
              padding: 18,
            }}
          >
            <div id="email-all-reports-title" style={{ fontWeight: 900, fontSize: 18, color: "#0f172a" }}>
              {emailAllResult
                ? "Report email summary"
                : `Send reports to all parents in ${emailAllPreview?.classroomName || classroomDisplayName}?`}
            </div>

            {emailAllPreviewLoading ? (
              <div style={{ marginTop: 14, color: "#475569", fontWeight: 800 }}>Loading preview…</div>
            ) : emailAllResult ? (
              <div style={{ marginTop: 14, fontWeight: 700, fontSize: 14, color: "#334155", lineHeight: 1.6 }}>
                <div>
                  Sent: <strong>{emailAllResult.sentCount}</strong>
                </div>
                <div>
                  Failed: <strong>{emailAllResult.failedCount}</strong>
                </div>
                <div>
                  Missing emails: <strong>{emailAllResult.missingEmailCount}</strong>
                </div>
                {emailAllResult.errors.length ? (
                  <ul style={{ marginTop: 10, paddingLeft: 18, maxHeight: 160, overflow: "auto" }}>
                    {emailAllResult.errors.slice(0, 12).map((err) => (
                      <li key={`${err.learnerId}-${err.reason}`}>
                        {err.learnerName || "Learner"}: {err.reason}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : emailAllPreview ? (
              <div style={{ marginTop: 14, fontWeight: 700, fontSize: 14, color: "#334155", lineHeight: 1.6 }}>
                <div>
                  Learners: <strong>{emailAllPreview.learnerCount}</strong>
                </div>
                <div>
                  Parent emails: <strong>{emailAllPreview.parentEmailCount}</strong>
                </div>
                {emailAllPreview.learnersWithoutEmail.length ? (
                  <div
                    style={{
                      marginTop: 12,
                      padding: "10px 12px",
                      borderRadius: 12,
                      background: "rgba(234, 179, 8, 0.12)",
                      border: "1px solid rgba(202, 138, 4, 0.35)",
                      color: "#854d0e",
                      fontWeight: 800,
                      fontSize: 13,
                    }}
                  >
                    {emailAllPreview.learnersWithoutEmail.length} learner(s) have no parent email on file.
                    <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontWeight: 700 }}>
                      {emailAllPreview.learnersWithoutEmail.slice(0, 8).map((row) => (
                        <li key={row.id}>{row.name}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button
                type="button"
                className="ec-page-btn"
                disabled={emailAllSending}
                onClick={() => setEmailAllOpen(false)}
              >
                {emailAllResult ? "Close" : "Cancel"}
              </button>
              {!emailAllResult ? (
                <button
                  type="button"
                  className="ec-page-btn ec-page-btn--gold"
                  disabled={emailAllSending || emailAllPreviewLoading || !emailAllPreview}
                  onClick={() => void confirmEmailAll()}
                >
                  {emailAllSending ? "Sending…" : "Confirm send"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {moveOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
            zIndex: 60,
          }}
          onMouseDown={() => setMoveOpen(false)}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "min(640px, 100%)",
              ...premiumCardStyle(),
              border: "1px solid rgba(212,175,55,0.22)",
              padding: 18,
            }}
          >
            <div style={{ fontWeight: 900, fontSize: 18, color: "#0f172a" }}>Move learners</div>
            <div style={{ marginTop: 6, fontWeight: 700, fontSize: 13, color: "#64748b" }}>
              Select the classroom to move {selectedChildIds.size} child(ren) to.
            </div>
            <div style={{ marginTop: 14 }}>
              <div style={fieldLabelStyle()}>Target classroom</div>
              <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} style={inputStyle()}>
                <option value="">Select…</option>
                {props.availableClassrooms
                  .filter((c) => c?.id && c.id !== props.classroomId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <button type="button" className="ec-page-btn" onClick={() => setMoveOpen(false)}>
                Cancel
              </button>
              <button type="button" className="ec-page-btn ec-page-btn--gold" onClick={confirmMove}>
                Move Selected
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {addOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
            zIndex: 70,
          }}
          onMouseDown={() => setAddOpen(false)}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: "min(920px, 100%)",
              ...premiumCardStyle(),
              border: "1px solid rgba(212,175,55,0.22)",
              padding: 18,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 18, color: "#0f172a" }}>Add learners to classroom</div>
                <div style={{ marginTop: 6, fontWeight: 700, fontSize: 13, color: "#64748b" }}>
                  Showing learners with no classroom assigned
                </div>
                <div style={{ height: 3, width: 126, background: "linear-gradient(90deg, #d4af37, rgba(212,175,55,0.08))", marginTop: 10, borderRadius: 999 }} />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ color: "#475569", fontWeight: 800, fontSize: 13 }}>Search</div>
                  <input
                    value={addSearch}
                    onChange={(e) => setAddSearch(e.target.value)}
                    placeholder="Name, surname, grade, class…"
                    style={{
                      height: 38,
                      borderRadius: 999,
                      border: "1px solid rgba(15, 23, 42, 0.14)",
                      background: "#ffffff",
                      color: "#0f172a",
                      padding: "0 14px",
                      outline: "none",
                      fontWeight: 700,
                      minWidth: 280,
                    }}
                  />
                </div>
              </div>
            </div>

            {addError ? (
              <div
                style={{
                  marginTop: 12,
                  background: "rgba(239, 68, 68, 0.10)",
                  border: "1px solid rgba(239, 68, 68, 0.28)",
                  color: "#7f1d1d",
                  padding: "10px 12px",
                  borderRadius: 14,
                  fontWeight: 900,
                }}
              >
                {addError}
              </div>
            ) : null}

            <div style={{ marginTop: 14, ...premiumCardStyle(), padding: 14, border: "1px solid rgba(212,175,55,0.18)" }}>
              <div className="ec-table-wrap">
                <table className="ec-table">
                  <thead>
                    <tr>
                      <th style={{ width: 54 }}>
                        <input type="checkbox" checked={allAddOnPageSelected} onChange={toggleAddAllOnPage} />
                      </th>
                      <th>Name</th>
                      <th>Surname</th>
                      <th style={{ width: 160 }}>Grade/Class</th>
                      <th style={{ width: 110 }}>Age</th>
                      <th style={{ width: 140 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {addLoading ? (
                      <tr>
                        <td colSpan={6} style={{ padding: 18, fontWeight: 800 }}>
                          Loading learners…
                        </td>
                      </tr>
                    ) : addRows.length ? (
                      addRows.map((l, index) => {
                        const checked = addSelectedIds.has(l.id);
                        return (
                          <tr
                            key={l.id}
                            className={[
                              "table-row",
                              index % 2 === 0 ? "row-white" : "row-gold",
                              checked ? "selected-row" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            onClick={() => toggleAddLearner(l.id)}
                            style={{ cursor: "pointer" }}
                          >
                            <td onClick={(e) => e.stopPropagation()}>
                              <input type="checkbox" checked={checked} onChange={() => toggleAddLearner(l.id)} />
                            </td>
                            <td style={{ fontWeight: 900 }}>{l.firstName}</td>
                            <td>{l.lastName}</td>
                            <td style={{ fontWeight: 900 }}>
                              {l.grade}
                            </td>
                            <td style={{ fontWeight: 900 }}>{formatAge(l.birthDate)}</td>
                            <td>—</td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={6} style={{ padding: 18, fontWeight: 800 }}>
                          No learners available to add.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <SimplePagination page={safeAddPage} totalPages={addTotalPages} onPageChange={setAddPage} />
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
              <div style={{ color: "#475569", fontWeight: 800, fontSize: 13 }}>
                Selected: <span style={{ color: "#0f172a", fontWeight: 900 }}>{addSelectedIds.size}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                <button type="button" className="ec-page-btn" onClick={() => setAddOpen(false)}>
                  Cancel
                </button>
                <button type="button" className="ec-page-btn ec-page-btn--gold" onClick={() => void addSelectedLearners()}>
                  Add Selected
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

