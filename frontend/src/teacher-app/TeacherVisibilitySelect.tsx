export type TeacherVisibility = "PRIVATE" | "CLASS_TEACHERS" | "ADMIN";

export const VISIBILITY_OPTIONS: { value: TeacherVisibility; label: string; hint: string }[] = [
  {
    value: "PRIVATE",
    label: "Private to me",
    hint: "Only you (and school admin) can see this",
  },
  {
    value: "CLASS_TEACHERS",
    label: "Shared with class teachers",
    hint: "All teachers assigned to this class can see it",
  },
  {
    value: "ADMIN",
    label: "Visible to school admin",
    hint: "School admin can audit; other teachers cannot see it",
  },
];

type Props = {
  value: TeacherVisibility;
  onChange: (value: TeacherVisibility) => void;
  disabled?: boolean;
  id?: string;
};

export default function TeacherVisibilitySelect({ value, onChange, disabled, id }: Props) {
  return (
    <div className="teacher-field">
      <label htmlFor={id || "teacher-visibility"}>Who can see this?</label>
      <select
        id={id || "teacher-visibility"}
        value={value}
        onChange={(e) => onChange(e.target.value as TeacherVisibility)}
        disabled={disabled}
      >
        {VISIBILITY_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <p className="teacher-muted" style={{ marginTop: 6, fontSize: "0.85rem" }}>
        {VISIBILITY_OPTIONS.find((o) => o.value === value)?.hint}
      </p>
    </div>
  );
}

export function visibilityBadge(visibility?: string | null, isDraft?: boolean) {
  if (isDraft) return "Draft";
  if (visibility === "PRIVATE") return "Private";
  if (visibility === "ADMIN") return "Admin only";
  return "Shared";
}
