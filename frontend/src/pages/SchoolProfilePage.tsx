import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import {
  fetchSchoolProfile,
  mapToApiPayload,
  saveSchoolProfile,
} from "../schoolProfile/api/schoolProfileApi";
import {
  createEmptySchoolProfileForm,
  schoolRecordToForm,
  type SchoolProfileFormState,
} from "../schoolProfile/types/schoolProfile";
import { useSchoolId } from "../useSchoolId";
import "./SchoolProfilePage.css";

type ProfileTab = "general" | "contact" | "address" | "billing" | "password";

type Props = {
  go: (page: any) => void;
};

type FormField = keyof SchoolProfileFormState;

export default function SchoolProfilePage({ go }: Props) {
  const schoolId = useSchoolId();
  const [profileTab, setProfileTab] = useState<ProfileTab>("general");
  const [menuOpen, setMenuOpen] = useState(false);
  const [form, setForm] = useState<SchoolProfileFormState>(createEmptySchoolProfileForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!schoolId) {
      setForm(createEmptySchoolProfileForm());
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchSchoolProfile(schoolId)
      .then((record) => {
        if (cancelled) return;
        setForm(schoolRecordToForm(record));
      })
      .catch(() => {
        if (cancelled) return;
        setForm(createEmptySchoolProfileForm());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  const setField = useCallback((field: FormField, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!schoolId) {
      alert("No school selected. Cannot save profile.");
      return;
    }

    if (form.newPassword || form.confirmPassword) {
      if (form.newPassword !== form.confirmPassword) {
        alert("Passwords do not match.");
        return;
      }
      alert("School profile saved. Password change is not available on this screen yet.");
    }

    setSaving(true);
    try {
      const payload = mapToApiPayload(form);
      const updated = await saveSchoolProfile(schoolId, payload);
      const savedGeneral = schoolRecordToForm(updated);
      setForm((prev) => ({
        ...savedGeneral,
        package: savedGeneral.package || prev.package,
        packageUntil: savedGeneral.packageUntil || prev.packageUntil,
        automaticRenew: savedGeneral.automaticRenew || prev.automaticRenew,
        automaticBilling: savedGeneral.automaticBilling || prev.automaticBilling,
        faxNo: prev.faxNo,
        postalAddress1: prev.postalAddress1,
        postalAddress2: prev.postalAddress2,
        postalAddress3: prev.postalAddress3,
        postalAddress4: prev.postalAddress4,
        bankingLine1: prev.bankingLine1,
        bankingLine2: prev.bankingLine2,
        bankingLine3: prev.bankingLine3,
        bankingLine4: prev.bankingLine4,
        newPassword: "",
        confirmPassword: "",
      }));
      if (updated.name) localStorage.setItem("schoolName", updated.name);
      if (!form.newPassword && !form.confirmPassword) {
        alert("Profile saved");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }, [form, schoolId]);

  const tabClass = (tab: ProfileTab) => (profileTab === tab ? "profile-tab active" : "profile-tab");

  const inputProps = (field: FormField, options?: { type?: string; placeholder?: string }) => ({
    value: form[field],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setField(field, e.target.value),
    type: options?.type,
    placeholder: options?.placeholder,
    disabled: loading || saving,
  });

  const readOnlyInputProps = (field: FormField) => ({
    value: form[field],
    readOnly: true,
    disabled: loading || saving,
  });

  return (
    <div className="profile-page school-profile-page">
      <div className="profile-actions">
        <button type="button" onClick={() => go("dashboard")} className="profile-btn">
          ↩ Back
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          className="profile-btn"
          disabled={loading || saving || !schoolId}
        >
          {saving ? "Saving…" : "💾 Save"}
        </button>
        <div className="profile-menu-wrap">
          <button type="button" onClick={() => setMenuOpen(!menuOpen)} className="profile-btn">
            More Actions⌄
          </button>
          {menuOpen && (
            <div className="profile-menu">
              <button type="button" onClick={() => document.getElementById("schoolLogoUpload")?.click()}>
                Upload Logo
              </button>
              <button type="button" onClick={() => go("schoolPackage")}>
                Change Package
              </button>
              <button type="button" onClick={() => window.print()}>
                Print Profile
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm("Are you sure you want to close this account?")) {
                    alert("Close account request confirmed");
                  }
                }}
              >
                Close Account
              </button>
            </div>
          )}
        </div>
        <input
          id="schoolLogoUpload"
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={() => alert("Logo selected")}
        />
      </div>

      <div className="profile-card">
        <aside className="profile-side">
          <span>School</span>
        </aside>
        <main className="profile-main">
          <div className="profile-tabs">
            <button type="button" onClick={() => setProfileTab("general")} className={tabClass("general")}>
              General
            </button>
            <button type="button" onClick={() => setProfileTab("contact")} className={tabClass("contact")}>
              Contact
            </button>
            <button type="button" onClick={() => setProfileTab("address")} className={tabClass("address")}>
              Address
            </button>
            <button type="button" onClick={() => setProfileTab("billing")} className={tabClass("billing")}>
              Billing
            </button>
            <button type="button" onClick={() => setProfileTab("password")} className={tabClass("password")}>
              Password
            </button>
          </div>

          <div className="profile-form">
            {profileTab === "general" && (
              <>
                <div className="form-row">
                  <label>Business Name</label>
                  <input {...inputProps("businessName")} />
                </div>
                <div className="form-row">
                  <label>Registered Email</label>
                  <input {...inputProps("registeredEmail")} type="email" />
                </div>
                <div className="form-row">
                  <label>Package</label>
                  <input {...readOnlyInputProps("package")} />
                </div>
                <div className="form-row">
                  <label>Package Until</label>
                  <input {...readOnlyInputProps("packageUntil")} />
                </div>
                <div className="form-row">
                  <label>Automatic Renew</label>
                  <input {...readOnlyInputProps("automaticRenew")} />
                </div>
                <div className="form-row">
                  <label>Automatic Billing</label>
                  <input {...readOnlyInputProps("automaticBilling")} />
                </div>
              </>
            )}

            {profileTab === "contact" && (
              <>
                <div className="form-row">
                  <label>Tel No</label>
                  <input {...inputProps("telNo")} />
                </div>
                <div className="form-row">
                  <label>Cell No</label>
                  <input {...inputProps("cellNo")} />
                </div>
                <div className="form-row">
                  <label>Fax No</label>
                  <input {...inputProps("faxNo")} />
                </div>
                <div className="form-row">
                  <label>Email</label>
                  <input {...inputProps("contactEmail")} type="email" />
                </div>
              </>
            )}

            {profileTab === "address" && (
              <>
                <div className="form-row">
                  <label>Physical Address</label>
                  <input {...inputProps("physicalAddress1")} />
                </div>
                <div className="form-row">
                  <label></label>
                  <input {...inputProps("physicalAddress2")} />
                </div>
                <div className="form-row">
                  <label></label>
                  <input {...inputProps("physicalAddress3")} />
                </div>
                <div className="form-row">
                  <label></label>
                  <input {...inputProps("physicalAddress4", { placeholder: "Physical Address Line 4" })} />
                </div>
                <div className="form-row">
                  <label>Postal Address</label>
                  <input {...inputProps("postalAddress1")} />
                </div>
                <div className="form-row">
                  <label></label>
                  <input {...inputProps("postalAddress2")} />
                </div>
                <div className="form-row">
                  <label></label>
                  <input {...inputProps("postalAddress3")} />
                </div>
                <div className="form-row">
                  <label></label>
                  <input {...inputProps("postalAddress4")} />
                </div>
              </>
            )}

            {profileTab === "billing" && (
              <>
                <div className="form-row">
                  <label>Banking Details</label>
                  <input {...inputProps("bankingLine1")} />
                </div>
                <div className="form-row">
                  <label></label>
                  <input {...inputProps("bankingLine2")} />
                </div>
                <div className="form-row">
                  <label></label>
                  <input {...inputProps("bankingLine3")} />
                </div>
                <div className="form-row">
                  <label></label>
                  <input {...inputProps("bankingLine4")} />
                </div>
              </>
            )}

            {profileTab === "password" && (
              <>
                <div className="form-row">
                  <label>New Password</label>
                  <input {...inputProps("newPassword", { type: "password" })} />
                </div>
                <div className="form-row">
                  <label>Confirm Password</label>
                  <input {...inputProps("confirmPassword", { type: "password" })} />
                </div>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
