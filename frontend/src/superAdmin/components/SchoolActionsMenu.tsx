import { useEffect, useId, useRef, useState } from "react";
import type { SchoolRecord } from "../types/schools";

type Props = {
  school: SchoolRecord;
  onView: (school: SchoolRecord) => void;
  onActivate: (school: SchoolRecord) => void;
  onSuspend: (school: SchoolRecord) => void;
  onChangePackage: (school: SchoolRecord) => void;
  onResetPassword: (school: SchoolRecord) => void;
};

export default function SchoolActionsMenu({
  school,
  onView,
  onActivate,
  onSuspend,
  onChangePackage,
  onResetPassword,
}: Props) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const run = (action: (record: SchoolRecord) => void) => {
    action(school);
    setOpen(false);
  };

  return (
    <div className="sa-schools-actions" ref={rootRef}>
      <button
        type="button"
        className="sa-schools-actions-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        Actions
        <span className="sa-schools-actions-chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div id={menuId} className="sa-schools-actions-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => run(onView)}>
            View School
          </button>
          {school.status !== "Active" ? (
            <button type="button" role="menuitem" onClick={() => run(onActivate)}>
              Activate
            </button>
          ) : null}
          {school.status !== "Suspended" ? (
            <button type="button" role="menuitem" onClick={() => run(onSuspend)}>
              Suspend
            </button>
          ) : null}
          <button type="button" role="menuitem" onClick={() => run(onChangePackage)}>
            Change Package
          </button>
          <button type="button" role="menuitem" onClick={() => run(onResetPassword)}>
            Reset Password
          </button>
        </div>
      ) : null}
    </div>
  );
}
