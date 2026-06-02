import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SchoolRecord } from "../types/schools";

type Props = {
  school: SchoolRecord;
  onView: (school: SchoolRecord) => void;
  onActivate: (school: SchoolRecord) => void;
  onSuspend: (school: SchoolRecord) => void;
  onChangePackage: (school: SchoolRecord) => void;
  onResetPassword: (school: SchoolRecord) => void;
  onOpenDashboard?: (school: SchoolRecord) => void;
};

export default function SchoolActionsMenu({
  school,
  onView,
  onActivate,
  onSuspend,
  onChangePackage,
  onResetPassword,
  onOpenDashboard,
}: Props) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | null>(null);

  const portalRoot = useMemo(() => (typeof document !== "undefined" ? document.body : null), []);
  const MENU_Z_INDEX = 99999;

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedInsideTrigger = !!triggerRef.current?.contains(target);
      const clickedInsideMenu = !!menuRef.current?.contains(target);
      if (!clickedInsideTrigger && !clickedInsideMenu) {
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

  useEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return undefined;
    }

    const positionMenu = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;

      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 10;
      const gap = 6;

      // Measure after it has layout.
      const menuRect = menu.getBoundingClientRect();

      const desiredRight = rect.right;
      const minLeft = viewportPadding;
      const maxLeft = window.innerWidth - viewportPadding - menuRect.width;
      const left = Math.min(Math.max(desiredRight - menuRect.width, minLeft), maxLeft);

      const spaceBelow = window.innerHeight - rect.bottom;
      const canOpenDown = spaceBelow >= menuRect.height + gap + viewportPadding;

      const top = canOpenDown
        ? Math.min(rect.bottom + gap, window.innerHeight - viewportPadding - menuRect.height)
        : Math.max(viewportPadding, rect.top - gap - menuRect.height);

      setMenuStyle({
        position: "fixed",
        top,
        left,
        right: "auto",
        bottom: "auto",
        zIndex: MENU_Z_INDEX,
      });
    };

    // Position on next frame to ensure menuRef exists + styles applied.
    const raf = window.requestAnimationFrame(positionMenu);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
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
        ref={triggerRef}
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

      {open && portalRoot
        ? createPortal(
            <div
              id={menuId}
              className="sa-schools-actions-menu"
              role="menu"
              ref={menuRef}
              style={
                menuStyle ?? {
                  position: "fixed",
                  top: 0,
                  left: -9999,
                  right: "auto",
                  bottom: "auto",
                  zIndex: MENU_Z_INDEX,
                }
              }
            >
              <button type="button" role="menuitem" onClick={() => run(onView)}>
                View
              </button>
              {school.canOpenDashboard && onOpenDashboard ? (
                <button type="button" role="menuitem" onClick={() => run(onOpenDashboard)}>
                  Open school dashboard
                </button>
              ) : null}
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
            </div>,
            portalRoot
          )
        : null}
    </div>
  );
}
