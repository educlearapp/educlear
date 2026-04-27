import { Navigate, useLocation } from "react-router-dom";
import type { ReactElement } from "react";

type Props = {
  element: ReactElement;
  requireSchool?: boolean;
};

function hasToken(): boolean {
  const t = localStorage.getItem("token");
  return Boolean(t && String(t).trim());
}

function hasSchoolId(): boolean {
  const s = localStorage.getItem("schoolId");
  return Boolean(s && String(s).trim());
}

export default function ProtectedRoute({ element, requireSchool = true }: Props) {
  const location = useLocation();

  if (!hasToken()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (requireSchool && !hasSchoolId()) {
    return <Navigate to="/select-school" replace state={{ from: location.pathname }} />;
  }

  return element;
}

