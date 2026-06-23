import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import {
  changeSchoolProfilePassword,
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
import {
  absolutizeSchoolLogoUrl,
  cacheSchoolLogoUrl,
  uploadSchoolLogoFile,
} from "../utils/schoolLogo";
import "./SchoolProfilePage.css";

type ProfileTab = "general" | "contact" | "address" | "billing" | "password";
type ProfileStatus = { type: "success" | "error"; message: string } | null;

type Props = {
  go: (page: any) => void;
};

type FormField = keyof SchoolProfileFormState;

export default function SchoolProfilePage({ go }: Props) {
  const schoolId = useSchoolId();
  const [profileTab, setProfileTab] = useState<ProfileTab>("general");
  const [menuOpen, setMenuOpen] = useState(false);
  const [form, setForm] = useState<SchoolProfileFormState>(createEmptySchoolProfileForm);
  const [logoUrl, setLogoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [status, setStatus] = useState<ProfileStatus>(null);

  useEffect(() => {
    if (!schoolId) {
      setForm(createEmptySchoolProfileForm());
      setLogoUrl("");
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchSchoolProfile(schoolId)
      .then((record) => {
        if (cancelled) return;
        if (!record) {
          setForm(createEmptySchoolProfileForm());
          setLogoUrl("");
          return;
        }
        setForm(schoolRecordToForm(record));
        const url = record.logoUrl ? absolutizeSchoolLogoUrl(record.logoUrl) : "";
        setLogoUrl(url);
        if (url) cacheSchoolLogoUrl(url);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[SchoolProfile] load failed:", err);
        setForm(createEmptySchoolProfileForm());
        setLogoUrl("");
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

  const handleLogoUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || !schoolId) return;

      setLogoUploading(true);
      setMenuOpen(false);
      setStatus(null);
      try {
        const uploaded = await uploadSchoolLogoFile(file);
        const payload = mapToApiPayload(form);
        const updated = await saveSchoolProfile(schoolId, { ...payload, logoUrl: uploaded });
        const savedUrl = updated.logoUrl ? absolutizeSchoolLogoUrl(updated.logoUrl) : uploaded;
        setLogoUrl(savedUrl);
        cacheSchoolLogoUrl(savedUrl);
        setStatus({ type: "success", message: "School logo saved." });
      } catch (err) {
        setStatus({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to upload logo",
        });
      } finally {
        setLogoUploading(false);
      }
    },
    [form, schoolId]
  );

  const handleSave = useCallback(async () => {
    if (!schoolId) {
      setStatus({ type: "error", message: "No school selected. Cannot save profile." });
      return;
    }

    const newPassword = form.newPassword;
    const confirmPassword = form.confirmPassword;
    const shouldChangePassword = Boolean(newPassword || confirmPassword);
    if (shouldChangePassword && newPassword !== confirmPassword) {
      setStatus({ type: "error", message: "New password and confirm password must match." });
      return;
    }
    if (shouldChangePassword && newPassword.length < 8) {
      setStatus({ type: "error", message: "New password must be at least 8 characters." });
      return;
    }

    setSaving(true);
    setStatus(null);
    try {
      const payload = mapToApiPayload({
        ...form,
        registeredEmail: form.registeredEmail.trim() || form.contactEmail.trim(),
        contactEmail: form.contactEmail.trim() || form.registeredEmail.trim(),
      });
      await saveSchoolProfile(schoolId, {
        ...payload,
        ...(logoUrl ? { logoUrl } : {}),
      });
      if (shouldChangePassword) {
        await changeSchoolProfilePassword(schoolId, newPassword);
      }
      const reloaded = await fetchSchoolProfile(schoolId);
      if (!reloaded) {
        throw new Error("Profile saved but could not reload from server");
      }
      const savedGeneral = schoolRecordToForm(reloaded);
      setForm((prev) => ({
        ...savedGeneral,
        package: savedGeneral.package || prev.package,
        packageUntil: savedGeneral.packageUntil || prev.packageUntil,
        automaticRenew: savedGeneral.automaticRenew || prev.automaticRenew,
        automaticBilling: savedGeneral.automaticBilling || prev.automaticBilling,
        faxNo: prev.faxNo,
        newPassword: "",
        confirmPassword: "",
      }));
      if (reloaded.name) localStorage.setItem("schoolName", reloaded.name);
      if (reloaded.logoUrl) {
        const url = absolutizeSchoolLogoUrl(reloaded.logoUrl);
        setLogoUrl(url);
        cacheSchoolLogoUrl(url);
      }
      setStatus({
        type: "success",
        message: shouldChangePassword ? "Profile saved and password updated." : "Profile saved.",
      });
    } catch (err) {
      setStatus({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to save profile",
      });
    } finally {
      setSaving(false);
    }
  }, [form, logoUrl, schoolId]);

  const tabClass = (tab: ProfileTab) => (profileTab === tab ? "profile-tab active" : "profile-tab");

  const inputProps = (field: FormField, options?: { type?: string; placeholder?: string }) => ({
    value: form[field],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setField(field, e.target.value),
    type: options?.type,
    placeholder: options?.placeholder,
    disabled: loading || saving || logoUploading,
  });

  const readOnlyInputProps = (field: FormField) => ({
    value: form[field],
    readOnly: true,
    disabled: loading || saving || logoUploading,
  });

  const logoPreview = logoUrl ? (
    <img src={logoUrl} alt="" className="school-profile-logo-img" />
  ) : (
    <div className="school-profile-logo-placeholder">No logo uploaded</div>
  );

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
          disabled={loading || saving || logoUploading || !schoolId}
        >
          {saving ? "Saving…" : "💾 Save"}
        </button>
        <div className="profile-menu-wrap">
          <button type="button" onClick={() => setMenuOpen(!menuOpen)} className="profile-btn">
            More Actions⌄
          </button>
          {menuOpen && (
            <div className="profile-menu">
              <button
                type="button"
                disabled={logoUploading}
                onClick={() => document.getElementById("schoolLogoUpload")?.click()}
              >
                {logoUploading ? "Uploading logo…" : "Upload Logo"}
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
                    setStatus({ type: "success", message: "Close account request confirmed." });
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
          accept="image/png,image/jpeg,image/webp,image/gif"
          style={{ display: "none" }}
          onChange={(e) => void handleLogoUpload(e)}
        />
      </div>

      <div className="profile-card">
        <aside className="profile-side school-profile-side">
          <div className="school-profile-logo-wrap">{logoPreview}</div>
          <button
            type="button"
            className="school-profile-logo-btn"
            disabled={loading || logoUploading || !schoolId}
            onClick={() => document.getElementById("schoolLogoUpload")?.click()}
          >
            {logoUploading ? "Uploading…" : "Change logo"}
          </button>
          <span className="school-profile-side-label">School</span>
        </aside>
        <main className="profile-main">
          {status && (
            <div
              className={`school-profile-status ${status.type}`}
              role={status.type === "error" ? "alert" : "status"}
            >
              {status.message}
            </div>
          )}
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
                <div className="form-row school-profile-logo-row">
                  <label>School logo</label>
                  <div className="school-profile-logo-inline">
                    {logoPreview}
                    <button
                      type="button"
                      className="profile-btn"
                      disabled={loading || logoUploading || !schoolId}
                      onClick={() => document.getElementById("schoolLogoUpload")?.click()}
                    >
                      {logoUploading ? "Uploading…" : "Upload logo"}
                    </button>
                  </div>
                </div>
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
