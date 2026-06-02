import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import MigrationSchoolSelect from "../../superAdmin/components/migration/MigrationSchoolSelect";
import type { SchoolOption } from "../../superAdmin/types/migration";
import {
  fetchMigrationTargetSchools,
  type MigrationTargetSchoolsDebug,
} from "../../superAdmin/utils/migrationTargetSchools";
import MigrationCentreTopupPaymentsPanel from "../migration/MigrationCentreTopupPaymentsPanel";
import UniversalMigrationCenterNav from "./UniversalMigrationCenterNav";
import "../migration/MigrationCentre.css";
import "../SuperAdminMigrationPage.css";

export default function LiveTopupPaymentsImportPage() {
  const navigate = useNavigate();
  const [schoolOptions, setSchoolOptions] = useState<SchoolOption[]>([]);
  const [schoolOptionsDebug, setSchoolOptionsDebug] = useState<MigrationTargetSchoolsDebug | null>(
    null
  );
  const [selectedSchoolId, setSelectedSchoolId] = useState("");

  useEffect(() => {
    void (async () => {
      const { schools, debug } = await fetchMigrationTargetSchools();
      setSchoolOptions(schools);
      setSchoolOptionsDebug(debug);
    })();
  }, []);

  return (
    <div className="sa-migration-page">
      <UniversalMigrationCenterNav />

      <div className="sa-migration-layout" style={{ marginTop: 20 }}>
        <div className="sa-migration-column sa-migration-column--primary">
          <MigrationSchoolSelect
            schools={schoolOptions}
            selectedSchoolId={selectedSchoolId}
            onSchoolChange={setSelectedSchoolId}
            debug={schoolOptionsDebug}
          />
        </div>
      </div>

      {selectedSchoolId ? (
        <MigrationCentreTopupPaymentsPanel
          schoolId={selectedSchoolId}
          onBack={() => navigate("/super-admin/migration")}
        />
      ) : (
        <p className="sa-migration-section-hint" style={{ marginTop: 16 }}>
          Select a target school to upload a Kid-e-Sys Transaction List export and run a dry-run preview.
        </p>
      )}
    </div>
  );
}

