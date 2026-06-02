import { useEffect, useState } from "react";
import { staffApiFetch } from "../staffApi";

export type AssignedClassroom = {
  id: string;
  name: string;
  teacherName?: string | null;
  teacherEmail?: string | null;
  learnerCount: number;
  role?: string;
  coTeacherCount?: number;
};

export type TeacherMeResponse = {
  success?: boolean;
  assignedClassNames?: string[];
  assignedClassrooms?: AssignedClassroom[];
  classrooms?: AssignedClassroom[];
};

export const NO_ASSIGNED_CLASSROOMS_MSG =
  "No classrooms are currently assigned to your account. Ask the school admin to assign your email to a classroom.";

export function parseAssignedClassrooms(me: TeacherMeResponse): AssignedClassroom[] {
  const rooms = me.assignedClassrooms?.length
    ? me.assignedClassrooms
    : me.classrooms?.length
      ? me.classrooms
      : [];
  const names = me.assignedClassNames ?? [];
  if (!rooms.length && names.length) {
    console.warn("[teacher-app] assignedClassNames present but assignedClassrooms empty:", names);
  }
  return rooms;
}

export function useTeacherAssignedClassrooms() {
  const [classrooms, setClassrooms] = useState<AssignedClassroom[]>([]);
  const [className, setClassName] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const me = (await staffApiFetch("/api/teacher-app/me")) as TeacherMeResponse;
        const rooms = parseAssignedClassrooms(me);
        setClassrooms(rooms);
        if (rooms.length === 1) {
          setClassName(rooms[0].name);
        } else if (rooms.length === 0) {
          console.info("[teacher-app] No assignedClassrooms for current teacher");
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Load failed";
        setErr(msg);
        console.error("[teacher-app] Failed to load assignedClassrooms:", msg);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const noAssigned = !loading && !err && classrooms.length === 0;

  return { classrooms, className, setClassName, loading, err, noAssigned };
}
