import React, { useEffect, useMemo, useState } from "react";
import {
  APP_ROLES,
  defaultPermissionGroups,
  mergePermissions,
  permissionsForRole,
  type AppRole,
  type ModuleKey,
  type PermissionAction,
  type PermissionMap,
  type SchoolUser,
} from "./permissions";
import {
  createSchoolUser,
  fetchSchoolUsers,
  patchUserPermissions,
  patchUserStatus,
  resetUserPassword,
  updateSchoolUser,
} from "./usersApi";

type Props = {
  schoolId: string;
};

const GOLD = "#d4af37";
const INK = "#111827";

const summaryCard: React.CSSProperties = {
  background: "#fff",
  borderRadius: 18,
  padding: "22px 20px",
  border: "1px solid rgba(212,175,55,0.35)",
  boxShadow: "0 10px 25px rgba(15,23,42,0.05)",
};

const goldBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "1px solid #b89329",
  background: "linear-gradient(135deg, #f7d56a, #d4af37)",
  color: INK,
  fontWeight: 900,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: INK,
  fontWeight: 800,
  cursor: "pointer",
  fontSize: 12,
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  fontWeight: 600,
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.55)",
  zIndex: 5000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
};

const modalPanel: React.CSSProperties = {
  background: "#fff",
  border: `2px solid ${GOLD}`,
  borderRadius: 14,
  width: "min(920px, 100%)",
  maxHeight: "92vh",
  overflow: "auto",
  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
};

function formatLastLogin(value: string | null) {
  if (!value) return "Never";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Never";
  return d.toLocaleString();
}

function displayName(user: SchoolUser) {
  return `${user.firstName || ""} ${user.surname || ""}`.trim() || user.fullName || user.email;
}

type FormState = {
  firstName: string;
  surname: string;
  email: string;
  password: string;
  appRole: AppRole | string;
  status: "Active" | "Disabled";
};

const emptyForm = (): FormState => ({
  firstName: "",
  surname: "",
  email: "",
  password: "",
  appRole: "Viewer",
  status: "Active",
});

export default function Users({ schoolId }: Props) {
  const [users, setUsers] = useState<SchoolUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All Roles");
  const [statusFilter, setStatusFilter] = useState("All Statuses");

  const [formOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<SchoolUser | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);

  const [permissionsUser, setPermissionsUser] = useState<SchoolUser | null>(null);
  const [permissionRole, setPermissionRole] = useState<AppRole | string>("Viewer");
  const [permissionMap, setPermissionMap] = useState<PermissionMap>(permissionsForRole("Viewer"));

  const [resetUser, setResetUser] = useState<SchoolUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState("");

  const loadUsers = async () => {
    if (!schoolId) {
      setUsers([]);
      setError("No school selected. Log in again or select a school to manage users.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const rows = await fetchSchoolUsers(schoolId);
      setUsers(rows);
    } catch (e: any) {
      setError(e?.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [schoolId]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "All Roles" && user.appRole !== roleFilter) return false;
      if (statusFilter !== "All Statuses" && user.status !== statusFilter) return false;
      if (!q) return true;
      const hay = `${displayName(user)} ${user.email} ${user.appRole}`.toLowerCase();
      return hay.includes(q);
    });
  }, [users, search, roleFilter, statusFilter]);

  const stats = useMemo(() => {
    const active = users.filter((u) => u.isActive).length;
    const disabled = users.filter((u) => !u.isActive).length;
    const custom = users.filter((u) => u.appRole === "Custom").length;
    return { total: users.length, active, disabled, custom };
  }, [users]);

  const openAdd = () => {
    setEditingUser(null);
    setForm(emptyForm());
    setFormOpen(true);
    setError("");
    setSuccess("");
  };

  const openEdit = (user: SchoolUser) => {
    setEditingUser(user);
    setForm({
      firstName: user.firstName,
      surname: user.surname,
      email: user.email,
      password: "",
      appRole: user.appRole,
      status: user.isActive ? "Active" : "Disabled",
    });
    setFormOpen(true);
    setError("");
    setSuccess("");
  };

  const openPermissions = (user: SchoolUser) => {
    setPermissionsUser(user);
    setPermissionRole(user.appRole);
    setPermissionMap(mergePermissions(user.permissions || permissionsForRole(user.appRole)));
    setError("");
    setSuccess("");
  };

  const handleRoleTemplateChange = (role: string) => {
    setPermissionRole(role);
    if (role === "Custom") {
      setPermissionMap((prev) => mergePermissions(prev));
    } else {
      setPermissionMap(permissionsForRole(role));
    }
  };

  const togglePermission = (module: string, action: string, value: boolean) => {
    if (permissionRole === "Owner") return;
    setPermissionRole("Custom");
    setPermissionMap((prev) => {
      const next = mergePermissions(prev);
      const mod = module as keyof PermissionMap;
      next[mod] = { ...next[mod], [action]: value };
      return next;
    });
  };

  const saveUserForm = async () => {
    if (!schoolId) return;
    if (!form.firstName.trim() || !form.email.trim()) {
      setError("Name and email are required.");
      return;
    }
    if (!editingUser && !form.password.trim()) {
      setError("Password is required for new users.");
      return;
    }
    if (form.password.trim() && form.password.trim().length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError("Enter a valid email address.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const payload: Record<string, unknown> = {
        schoolId,
        firstName: form.firstName.trim(),
        surname: form.surname.trim(),
        email: form.email.trim(),
        appRole: form.appRole,
        status: form.status,
        isActive: form.status === "Active",
      };
      if (form.password.trim()) payload.password = form.password.trim();

      if (editingUser) {
        await updateSchoolUser(editingUser.id, payload);
        setSuccess("User updated successfully.");
      } else {
        await createSchoolUser(payload);
        setSuccess("User created successfully.");
      }
      setFormOpen(false);
      await loadUsers();
    } catch (e: any) {
      setError(e?.message || "Failed to save user");
    } finally {
      setSaving(false);
    }
  };

  const toggleUserStatus = async (user: SchoolUser) => {
    const next = user.isActive ? "Disabled" : "Active";
    setError("");
    try {
      await patchUserStatus(user.id, next);
      setSuccess(`User ${next === "Active" ? "activated" : "disabled"}.`);
      await loadUsers();
    } catch (e: any) {
      setError(e?.message || "Failed to update status");
    }
  };

  const savePermissions = async () => {
    if (!permissionsUser) return;
    setSaving(true);
    setError("");
    try {
      const perms =
        permissionRole === "Owner" ? permissionsForRole("Owner") : mergePermissions(permissionMap);
      await patchUserPermissions(permissionsUser.id, {
        appRole: permissionRole,
        permissions: perms,
      });
      setPermissionsUser(null);
      setSuccess("Permissions saved.");
      await loadUsers();
    } catch (e: any) {
      setError(e?.message || "Failed to save permissions");
    } finally {
      setSaving(false);
    }
  };

  const submitResetPassword = async () => {
    if (!resetUser) return;
    if (!resetPassword || resetPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (resetPassword !== resetConfirm) {
      setError("Passwords do not match.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await resetUserPassword(resetUser.id, resetPassword);
      setResetUser(null);
      setResetPassword("");
      setResetConfirm("");
      setSuccess("Password reset successfully.");
    } catch (e: any) {
      setError(e?.message || "Failed to reset password");
    } finally {
      setSaving(false);
    }
  };

  const isOwnerLocked = (user: SchoolUser) => user.appRole === "Owner";

  return (
    <div className="users-page" style={{ padding: "8px 4px 32px" }}>
      <h1 className="page-title">Users &amp; Permissions</h1>
      <p style={{ color: "#64748b", marginTop: -8, marginBottom: 20, fontWeight: 600 }}>
        Manage school users, roles, and module access for your team.
      </p>

      {error ? (
        <div
          style={{
            marginBottom: 14,
            padding: 12,
            borderRadius: 10,
            background: "#fef2f2",
            color: "#b91c1c",
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      ) : null}
      {success ? (
        <div
          style={{
            marginBottom: 14,
            padding: 12,
            borderRadius: 10,
            background: "#ecfdf5",
            color: "#047857",
            fontWeight: 700,
          }}
        >
          {success}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 16,
          marginBottom: 20,
        }}
      >
        {[
          { label: "Total Users", value: stats.total },
          { label: "Active Users", value: stats.active },
          { label: "Disabled Users", value: stats.disabled },
          { label: "Custom Roles", value: stats.custom },
        ].map((card) => (
          <div key={card.label} style={summaryCard}>
            <div style={{ fontSize: 13, color: "#64748b", fontWeight: 700 }}>{card.label}</div>
            <div style={{ fontSize: 30, fontWeight: 900, color: INK, marginTop: 6 }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div
        style={{
          ...summaryCard,
          marginBottom: 18,
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", flex: 1 }}>
          <input
            style={{ ...fieldStyle, minWidth: 220, flex: "1 1 220px" }}
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select style={fieldStyle} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option>All Roles</option>
            {APP_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <select style={fieldStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option>All Statuses</option>
            <option>Active</option>
            <option>Disabled</option>
          </select>
        </div>
        <button type="button" style={goldBtn} onClick={openAdd}>
          + Add User
        </button>
      </div>

      <div style={{ ...summaryCard, padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
            <thead>
              <tr style={{ background: "rgba(212,175,55,0.16)" }}>
                {["Name", "Email", "Role", "Status", "Last Login", "Actions"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: 14,
                      textAlign: "left",
                      fontSize: 12,
                      fontWeight: 900,
                      color: "#334155",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                    Loading users…
                  </td>
                </tr>
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                    No users match your filters.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr key={user.id}>
                    <td style={{ padding: 14, borderBottom: "1px solid #f1f5f9", fontWeight: 800 }}>
                      {displayName(user)}
                    </td>
                    <td style={{ padding: 14, borderBottom: "1px solid #f1f5f9" }}>{user.email}</td>
                    <td style={{ padding: 14, borderBottom: "1px solid #f1f5f9" }}>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "4px 10px",
                          borderRadius: 999,
                          background: "rgba(212,175,55,0.18)",
                          fontWeight: 800,
                          fontSize: 12,
                        }}
                      >
                        {user.appRole}
                      </span>
                    </td>
                    <td style={{ padding: 14, borderBottom: "1px solid #f1f5f9" }}>
                      <span
                        style={{
                          color: user.isActive ? "#047857" : "#b91c1c",
                          fontWeight: 800,
                        }}
                      >
                        {user.status}
                      </span>
                    </td>
                    <td style={{ padding: 14, borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                      {formatLastLogin(user.lastLoginAt)}
                    </td>
                    <td style={{ padding: 14, borderBottom: "1px solid #f1f5f9" }}>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button type="button" style={ghostBtn} onClick={() => openEdit(user)}>
                          Edit
                        </button>
                        <button type="button" style={ghostBtn} onClick={() => toggleUserStatus(user)}>
                          {user.isActive ? "Disable" : "Activate"}
                        </button>
                        <button type="button" style={ghostBtn} onClick={() => setResetUser(user)}>
                          Reset Password
                        </button>
                        <button type="button" style={ghostBtn} onClick={() => openPermissions(user)}>
                          Permissions
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {formOpen ? (
        <div style={overlay}>
          <div style={modalPanel}>
            <div
              style={{
                padding: "20px 24px",
                borderBottom: `1px solid ${GOLD}`,
                background: INK,
                color: GOLD,
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 20 }}>
                {editingUser ? "Edit User" : "Add User"}
              </div>
            </div>
            <div
              style={{
                padding: 24,
                display: "grid",
                gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                gap: 14,
              }}
            >
              <label>
                Name
                <input
                  style={fieldStyle}
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                />
              </label>
              <label>
                Surname
                <input
                  style={fieldStyle}
                  value={form.surname}
                  onChange={(e) => setForm((f) => ({ ...f, surname: e.target.value }))}
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  style={fieldStyle}
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                />
              </label>
              <label>
                {editingUser ? "New Password (optional)" : "Password"}
                <input
                  type="password"
                  style={fieldStyle}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder={editingUser ? "Leave blank to keep current" : "Minimum 8 characters"}
                />
              </label>
              <label>
                Role
                <select
                  style={fieldStyle}
                  value={form.appRole}
                  onChange={(e) => setForm((f) => ({ ...f, appRole: e.target.value }))}
                  disabled={Boolean(editingUser && isOwnerLocked(editingUser))}
                >
                  {APP_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Status
                <select
                  style={fieldStyle}
                  value={form.status}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, status: e.target.value as "Active" | "Disabled" }))
                  }
                  disabled={Boolean(editingUser && isOwnerLocked(editingUser))}
                >
                  <option value="Active">Active</option>
                  <option value="Disabled">Disabled</option>
                </select>
              </label>
            </div>
            <div style={{ padding: "0 24px 24px", display: "flex", gap: 10 }}>
              <button type="button" style={goldBtn} onClick={saveUserForm} disabled={saving}>
                {saving ? "Saving…" : "Save User"}
              </button>
              <button type="button" style={ghostBtn} onClick={() => setFormOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {permissionsUser ? (
        <div style={overlay}>
          <div style={{ ...modalPanel, width: "min(1100px, 100%)" }}>
            <div
              style={{
                padding: "20px 24px",
                borderBottom: `1px solid ${GOLD}`,
                background: INK,
                color: GOLD,
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 20 }}>Manage Permissions</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
                {displayName(permissionsUser)} · {permissionsUser.email}
              </div>
            </div>
            <div style={{ padding: 24 }}>
              <label style={{ display: "block", marginBottom: 16 }}>
                Role template
                <select
                  style={{ ...fieldStyle, marginTop: 6, maxWidth: 280 }}
                  value={permissionRole}
                  onChange={(e) => handleRoleTemplateChange(e.target.value)}
                  disabled={permissionsUser.appRole === "Owner"}
                >
                  {APP_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              {permissionRole === "Owner" ? (
                <div
                  style={{
                    padding: 12,
                    borderRadius: 10,
                    background: "#fffbeb",
                    color: "#92400e",
                    fontWeight: 600,
                    marginBottom: 16,
                  }}
                >
                  Owner accounts always have full access and cannot be restricted.
                </div>
              ) : null}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                  <thead>
                    <tr style={{ background: "rgba(212,175,55,0.12)" }}>
                      <th style={{ padding: 10, textAlign: "left", fontWeight: 900 }}>Module</th>
                      {defaultPermissionGroups[0]?.actions.map((action) => (
                        <th key={action.key} style={{ padding: 10, textAlign: "center", fontSize: 12 }}>
                          {action.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {defaultPermissionGroups.map((group) => (
                      <tr key={group.module}>
                        <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", fontWeight: 800 }}>
                          {group.label}
                        </td>
                        {group.actions.map((action) => (
                          <td
                            key={`${group.module}-${action.key}`}
                            style={{ padding: 10, borderBottom: "1px solid #f1f5f9", textAlign: "center" }}
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(
                                permissionMap[group.module as ModuleKey]?.[action.key as PermissionAction]
                              )}
                              disabled={permissionRole === "Owner"}
                              onChange={(e) => togglePermission(group.module, action.key, e.target.checked)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div style={{ padding: "0 24px 24px", display: "flex", gap: 10 }}>
              <button type="button" style={goldBtn} onClick={savePermissions} disabled={saving}>
                {saving ? "Saving…" : "Save Permissions"}
              </button>
              <button type="button" style={ghostBtn} onClick={() => setPermissionsUser(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {resetUser ? (
        <div style={overlay}>
          <div style={{ ...modalPanel, width: "min(480px, 100%)" }}>
            <div
              style={{
                padding: "20px 24px",
                borderBottom: `1px solid ${GOLD}`,
                background: INK,
                color: GOLD,
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 20 }}>Reset Password</div>
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>{resetUser.email}</div>
            </div>
            <div style={{ padding: 24, display: "grid", gap: 14 }}>
              <label>
                New password
                <input
                  type="password"
                  style={fieldStyle}
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                />
              </label>
              <label>
                Confirm password
                <input
                  type="password"
                  style={fieldStyle}
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                />
              </label>
            </div>
            <div style={{ padding: "0 24px 24px", display: "flex", gap: 10 }}>
              <button type="button" style={goldBtn} onClick={submitResetPassword} disabled={saving}>
                {saving ? "Saving…" : "Reset Password"}
              </button>
              <button
                type="button"
                style={ghostBtn}
                onClick={() => {
                  setResetUser(null);
                  setResetPassword("");
                  setResetConfirm("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
