import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { apiFetch, API_URL } from "./api";
import "./LearnerPremium.css";

function clampPage(page: number, totalPages: number): number {
  const tp = Math.max(1, totalPages);
  const p = Math.trunc(Number(page) || 1);
  return Math.min(tp, Math.max(1, p));
}

function SimplePagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  const safePage = clampPage(page, totalPages);
  const tp = Math.max(1, totalPages);
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

function internalPageShellStyle(): CSSProperties {
  return {
    padding: "24px",
    background: "#f3f4f6",
    minHeight: "100%",
    borderRadius: "6px",
    border: "1px solid rgba(15, 23, 42, 0.10)",
    boxShadow: "none",
  };
}

function goldPrimaryBtnStyle(): CSSProperties {
  return {
    borderColor: "rgba(15, 23, 42, 0.18)",
    background: "#d4af37",
    color: "#0b1220",
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
        teacherEmail: String(c.teacherEmail || "").trim(),
        children: c.learners || c.children || [],
        childrenCount: c.childrenCount ?? (c.learners?.length || 0),
        minAgeMonths: c.minAgeMonths ?? null,
        maxAgeMonths: c.maxAgeMonths ?? null,
        notes: c.notes ?? "",
      }));
      console.log("CLASSROOM DATA:", normalized[0]);
      setClassrooms(normalized);
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
      await apiFetch(`/api/classrooms`, {
        method: "POST",
        body: JSON.stringify({
          schoolId,
          name,
          teacher: addTeacher.trim(),
          teacherEmail: addTeacherEmail.trim().toLowerCase(),
        }),
      });
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
        teacherEmail: String(c.teacherEmail || "").trim(),
        children: c.learners || c.children || [],
        childrenCount: c.childrenCount ?? (c.learners?.length || 0),
        minAgeMonths: c.minAgeMonths ?? null,
        maxAgeMonths: c.maxAgeMonths ?? null,
        notes: c.notes ?? "",
      }));
      setClassrooms(normalized);
      const created = normalized.find((c) => c.name === name);
      if (created?.id) setSelectedId(created.id);
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
    <div
      style={{
        ...internalPageShellStyle(),
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#0f172a", fontSize: 28, fontWeight: 900, letterSpacing: "-0.01em" }}>Classrooms</div>
          <div style={{ marginTop: 6, color: "#475569", fontWeight: 700, fontSize: 14 }}>
            Manage your classrooms
          </div>
          <div style={{ height: 3, width: 86, background: "linear-gradient(90deg, #d4af37, rgba(212,175,55,0.08))", marginTop: 10, borderRadius: 999 }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              setAddOpen(true);
              setMessage(null);
            }}
            className="ec-page-btn"
            style={goldPrimaryBtnStyle()}
          >
            + Add
          </button>
          <button type="button" onClick={onManage} className="ec-page-btn">
            Manage
          </button>

          <div style={{ marginLeft: 8, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ color: "#475569", fontWeight: 800, fontSize: 13 }}>Search</div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or teacher…"
              style={{
                height: 38,
                borderRadius: 999,
                border: "1px solid rgba(15, 23, 42, 0.14)",
                background: "#ffffff",
                color: "#0f172a",
                padding: "0 14px",
                outline: "none",
                fontWeight: 700,
                minWidth: 240,
              }}
            />
          </div>
        </div>
      </div>

      {message ? (
        <div style={{ marginTop: 14, background: "rgba(212,175,55,0.18)", border: "1px solid rgba(212,175,55,0.45)", color: "#0f172a", padding: "12px 14px", borderRadius: 14, fontWeight: 800 }}>
          {message}
        </div>
      ) : null}

      <div style={{ marginTop: 18, ...premiumCardStyle(), padding: 14 }}>
        <div className="ec-table-wrap">
          <table className="ec-table">
            <thead>
              <tr>
                <th style={{ width: "55%" }}>Name</th>
                <th>Teacher</th>
                <th style={{ width: 120 }}>Children</th>
              </tr>
            </thead>
            <tbody>
              {loadingList ? (
                <tr>
                  <td colSpan={3} style={{ padding: 18, fontWeight: 800 }}>
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
                    style={{ cursor: "pointer" }}
                  >
                    <td style={{ fontWeight: 900 }}>{c.name}</td>
                    <td>{c.teacher || "—"}</td>
                    <td style={{ fontWeight: 900 }}>{c.childrenCount}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} style={{ padding: 18, fontWeight: 800 }}>
                    No classrooms found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <SimplePagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
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
              <button
                type="button"
                className="ec-page-btn"
                onClick={onCreate}
                style={goldPrimaryBtnStyle()}
              >
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

      // IMPORTANT: do not overwrite teacher/children if API payload is incomplete.
      if (c) {
        const apiTeacher = String(c?.teacher ?? "").trim();
        const apiTeacherEmail = String(c?.teacherEmail ?? "").trim();
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
        if (apiTeacher) merged.teacher = apiTeacher;
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
          teacher: String(props.classroomForm.teacher ?? ""),
          teacherEmail: String(props.classroomForm.teacherEmail ?? "").trim().toLowerCase(),
          minAgeYears: props.classroomForm.minAgeYears,
          minAgeExtraMonths: props.classroomForm.minAgeMonths,
          maxAgeYears: props.classroomForm.maxAgeYears,
          maxAgeExtraMonths: props.classroomForm.maxAgeMonths,
          notes: String(props.classroomForm.notes ?? ""),
        }),
      });
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
      setMessage("Saved.");
    } catch (e: any) {
      setMessage(e?.message || "Failed to save classroom.");
    } finally {
      setSaving(false);
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

  return (
    <div
      style={{
        ...internalPageShellStyle(),
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button type="button" className="ec-page-btn" onClick={() => props.onBack()}>
            Back
          </button>
          <button
            type="button"
            className="ec-page-btn"
            onClick={save}
            disabled={saving}
            style={goldPrimaryBtnStyle()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        <div style={{ position: "relative" }}>
          <button type="button" className="ec-page-btn" onClick={() => setMenuOpen((v) => !v)}>
            More Actions
          </button>
          {menuOpen ? (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: 44,
                width: 220,
                background: "#ffffff",
                border: "1px solid rgba(15, 23, 42, 0.14)",
                borderRadius: 14,
                boxShadow: "0 18px 48px rgba(15, 23, 42, 0.16)",
                overflow: "hidden",
                zIndex: 5,
              }}
              onMouseLeave={() => setMenuOpen(false)}
            >
              <button
                type="button"
                style={{ width: "100%", textAlign: "left", padding: "10px 12px", border: 0, background: "transparent", fontWeight: 900, cursor: "pointer" }}
                onClick={() => {
                  setMenuOpen(false);
                  void deleteClassroom();
                }}
              >
                Delete classroom
              </button>
              <button
                type="button"
                style={{ width: "100%", textAlign: "left", padding: "10px 12px", border: 0, background: "transparent", fontWeight: 900, cursor: "pointer" }}
                onClick={() => {
                  setMenuOpen(false);
                  const merged: ClassroomForm = { ...props.classroomForm, teacher: "", teacherEmail: "" };
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
                  setMessage("Teacher cleared. Click Save to persist.");
                }}
              >
                Clear teacher
              </button>
              <button
                type="button"
                style={{ width: "100%", textAlign: "left", padding: "10px 12px", border: 0, background: "transparent", fontWeight: 900, cursor: "pointer" }}
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
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <h1>{form.name}</h1>
        {loading ? <div style={{ color: "#475569", fontWeight: 800 }}>Loading…</div> : null}
      </div>

      {message ? (
        <div style={{ marginTop: 12, background: "rgba(212,175,55,0.18)", border: "1px solid rgba(212,175,55,0.45)", color: "#0f172a", padding: "12px 14px", borderRadius: 14, fontWeight: 800 }}>
          {message}
        </div>
      ) : null}

      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 14 }}>
        <div style={{ ...premiumCardStyle(), padding: 16, border: "1px solid rgba(212,175,55,0.18)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900, fontSize: 16, color: "#0f172a" }}>Classroom</div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 900, fontSize: 12, color: "#0f172a", padding: "6px 10px", borderRadius: 999, background: "rgba(212,175,55,0.14)", border: "1px solid rgba(212,175,55,0.35)" }}>
                General
              </span>
            </div>
          </div>
          <div style={{ height: 3, width: 76, background: "linear-gradient(90deg, #d4af37, rgba(212,175,55,0.08))", marginTop: 10, borderRadius: 999 }} />

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

        <div style={{ ...premiumCardStyle(), padding: 16, border: "1px solid rgba(212,175,55,0.18)" }}>
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

      <div style={{ marginTop: 16, ...premiumCardStyle(), padding: 14, border: "1px solid rgba(212,175,55,0.18)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16, color: "#0f172a" }}>Children</div>
            <div style={{ marginTop: 6, fontWeight: 700, fontSize: 13, color: "#64748b" }}>
              Learners assigned to this classroom
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="ec-page-btn" onClick={() => void openAddModal()} style={goldPrimaryBtnStyle()}>
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
              <button
                type="button"
                className="ec-page-btn"
                onClick={confirmMove}
                style={goldPrimaryBtnStyle()}
              >
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
                <button type="button" className="ec-page-btn" onClick={() => void addSelectedLearners()} style={goldPrimaryBtnStyle()}>
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

