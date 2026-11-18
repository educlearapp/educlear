import { useEffect, useMemo, useRef, useState } from "react";
import type { SchoolOption } from "../../superAdmin/types/migration";

type Props = {
  schools: SchoolOption[];
  selectedSchoolId: string;
  onSchoolChange: (schoolId: string) => void;
  disabled?: boolean;
  loading?: boolean;
  locked?: boolean;
};

function shortId(id: string): string {
  const value = String(id || "").trim();
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function schoolMatches(school: SchoolOption, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    school.name.toLowerCase().includes(q) ||
    school.id.toLowerCase().includes(q) ||
    shortId(school.id).toLowerCase().includes(q)
  );
}

export default function UniversalMigrationSchoolPicker({
  schools,
  selectedSchoolId,
  onSchoolChange,
  disabled = false,
  loading = false,
  locked = false,
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = schools.find((s) => s.id === selectedSchoolId) ?? null;

  const filtered = useMemo(() => {
    const list = schools.filter((s) => schoolMatches(s, query));
    return list.slice(0, 80);
  }, [schools, query]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function requestChange(nextId: string) {
    if (nextId === selectedSchoolId) {
      setOpen(false);
      return;
    }
    if (selectedSchoolId && nextId && nextId !== selectedSchoolId) {
      const nextName = schools.find((s) => s.id === nextId)?.name || nextId;
      const currentName = selected?.name || selectedSchoolId;
      const ok = window.confirm(
        [
          "Change destination school?",
          "",
          `Currently selected: ${currentName}`,
          `Change to: ${nextName}`,
          "",
          "Only change this if you chose the wrong school. Imported data always goes into the selected school only.",
        ].join("\n")
      );
      if (!ok) return;
    }
    onSchoolChange(nextId);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="uc-migration-school-picker" ref={rootRef}>
      <label className="uc-migration-staging-source-label" htmlFor="uc-mig-school-search">
        Migration Target
      </label>
      <div className="uc-migration-school-picker-controls">
        <input
          id="uc-mig-school-search"
          type="search"
          className="uc-migration-staging-source-input uc-migration-school-picker-search"
          placeholder={loading ? "Loading schools…" : "Search school name or id…"}
          value={open ? query : selected ? selected.name : query}
          disabled={disabled || loading || locked}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            if (!locked && !disabled) {
              setOpen(true);
              setQuery("");
            }
          }}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="uc-mig-school-list"
          autoComplete="off"
        />
        {selectedSchoolId && !locked ? (
          <button
            type="button"
            className="uc-migration-upload-clear"
            disabled={disabled || loading}
            onClick={() => requestChange("")}
          >
            Clear school
          </button>
        ) : null}
      </div>

      {open && !locked && !disabled ? (
        <ul
          id="uc-mig-school-list"
          className="uc-migration-school-picker-list"
          role="listbox"
          aria-label="Matching schools"
        >
          {filtered.length === 0 ? (
            <li className="uc-migration-school-picker-empty">No schools match that search.</li>
          ) : (
            filtered.map((school) => {
              const isSelected = school.id === selectedSchoolId;
              return (
                <li key={school.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`uc-migration-school-picker-option${
                      isSelected ? " uc-migration-school-picker-option--selected" : ""
                    }`}
                    onClick={() => requestChange(school.id)}
                  >
                    <span className="uc-migration-school-picker-option-name">{school.name}</span>
                    <span className="uc-migration-school-picker-option-id">
                      ID {shortId(school.id)}
                    </span>
                  </button>
                </li>
              );
            })
          )}
          {schools.length > filtered.length ? (
            <li className="uc-migration-school-picker-empty">
              Showing {filtered.length} of {schools.length}. Type more to narrow the list.
            </li>
          ) : null}
        </ul>
      ) : null}

      {selected ? (
        <div className="uc-migration-school-picker-confirm" role="status">
          <p className="uc-migration-school-picker-confirm-label">Selected destination</p>
          <p className="uc-migration-school-picker-confirm-name">{selected.name}</p>
          <p className="uc-migration-school-picker-confirm-id">School id: {selected.id}</p>
          <p className="uc-migration-school-picker-confirm-hint">
            {locked
              ? "Locked for this migration. Use Start New Migration to choose a different school."
              : "Double-check this name before uploading. Wrong school = wrong destination."}
          </p>
        </div>
      ) : (
        <p className="uc-migration-upload-error" role="status">
          Search and choose the destination school first.
        </p>
      )}
    </div>
  );
}
