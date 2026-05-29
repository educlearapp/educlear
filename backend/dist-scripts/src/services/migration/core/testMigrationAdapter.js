"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testMigrationAdapter = testMigrationAdapter;
const adapters_1 = require("../adapters");
const migrationTemplateStore_1 = require("../templates/migrationTemplateStore");
const computeTransactionReadiness_1 = require("./computeTransactionReadiness");
const kidESysReadinessRequiredFields_1 = require("./kidESysReadinessRequiredFields");
const resolveMigrationAdapter_1 = require("./resolveMigrationAdapter");
const CHECK_LABELS = {
    adapter_exists: "Adapter registered",
    expected_files_present: "Expected files present",
    required_fields_mapped: "Required fields mapped",
    preview_available: "Preview available",
    full_validation_available: "Full validation available",
    readiness_template_available: "Readiness template available",
    template_mappings_available: "Template mappings available",
    transaction_readiness_available: "Transaction readiness available",
    kideesys_naming_detected: "Kid-e-Sys naming detected",
    kideesys_columns_recognized: "Known Kid-e-Sys columns recognised",
    kideesys_readiness_compatibility: "Readiness template compatibility",
    kideesys_normalization_confidence: "Normalization confidence",
    generic_spreadsheet_readable: "Spreadsheet structure readable",
    generic_headers_detected: "Headers detected",
    generic_fields_recognized: "Domain fields recognised",
    generic_ambiguous_fields_review: "Ambiguous fields require review",
    generic_mapping_confidence: "Mapping confidence acceptable",
    sasams_naming_detected: "SA-SAMS naming detected",
    sasams_columns_recognized: "Known SA-SAMS columns recognised",
    sasams_readiness_compatibility: "Readiness template compatibility",
    sasams_normalization_confidence: "Normalization confidence",
    sasams_administrative_identifiers: "Administrative identifiers recognised",
};
function isGenericExcelSystemId(systemId) {
    const id = String(systemId || "").trim();
    return id === "generic-excel-csv" || id === "generic-excel";
}
function makeCheck(id, status, message, details) {
    return {
        id,
        label: CHECK_LABELS[id],
        status,
        message,
        ...(details ? { details } : {}),
    };
}
function uploadedCategories(files) {
    return new Set(files.map((f) => f.category));
}
function hasTransactionFiles(uploadedFiles, previews, mappings) {
    if (uploadedFiles.some((f) => f.category === "transactions"))
        return true;
    if (previews.some((p) => String(p.category || "") === "transactions"))
        return true;
    const transactionTargets = new Set([
        "transactionDate",
        "amount",
        "debit",
        "credit",
        "reference",
        "description",
    ]);
    return mappings.some((fileMapping) => fileMapping.mappings.some((m) => transactionTargets.has(String(m.targetField || "").trim())));
}
function deriveOverallStatus(checks) {
    if (checks.some((c) => c.status === "fail"))
        return "fail";
    if (checks.some((c) => c.status === "warning"))
        return "warning";
    const actionable = checks.filter((c) => c.status !== "not_supported");
    if (actionable.length > 0 && actionable.every((c) => c.status === "pass"))
        return "pass";
    return "warning";
}
function deriveRecommendation(overallStatus, checks) {
    const adapterCheck = checks.find((c) => c.id === "adapter_exists");
    if (adapterCheck?.status === "fail" || overallStatus === "fail") {
        return "needs_research";
    }
    if (overallStatus === "pass" && !checks.some((c) => c.status === "warning")) {
        return "ready";
    }
    if (overallStatus === "warning" || checks.some((c) => c.status === "warning")) {
        return "partial";
    }
    return "needs_research";
}
function partitionChecks(checks) {
    return {
        passed: checks.filter((c) => c.status === "pass"),
        warnings: checks.filter((c) => c.status === "warning"),
        failed: checks.filter((c) => c.status === "fail"),
        notSupported: checks.filter((c) => c.status === "not_supported"),
    };
}
function appendKidESysAdapterChecks(checks, input) {
    const filenames = [
        ...input.uploadedFiles.map((f) => f.filename),
        ...input.previews.map((p) => p.filename),
    ].filter(Boolean);
    const allColumns = input.previews.flatMap((p) => Array.isArray(p.columns) ? p.columns.map((c) => String(c).trim()).filter(Boolean) : []);
    const detection = (0, adapters_1.evaluateKidESysDetection)({ filenames, columns: allColumns });
    checks.push(makeCheck("kideesys_naming_detected", detection.detected ? "pass" : "fail", detection.detected
        ? "Kid-e-Sys export naming or header bundle signals detected."
        : "Kid-e-Sys export naming not detected with sufficient confidence.", detection.reason));
    const { mapped, unmapped } = (0, adapters_1.normalizeKidESysColumns)(allColumns);
    const rules = adapters_1.KIDEESYS_CONFIDENCE_RULES;
    const ratio = (0, adapters_1.kidESysNormalizationConfidence)(allColumns);
    if (allColumns.length === 0) {
        checks.push(makeCheck("kideesys_columns_recognized", "fail", "No column headers available to recognise Kid-e-Sys fields.", "Load file previews before testing."));
    }
    else if (mapped.length >= rules.minNormalizedColumnCount &&
        ratio >= rules.minNormalizedColumnRatio) {
        checks.push(makeCheck("kideesys_columns_recognized", "pass", `${mapped.length} known Kid-e-Sys column(s) recognised in previews.`, mapped.map((m) => `${m.sourceColumn}→${m.targetField}`).join(", ")));
    }
    else if (mapped.length > 0) {
        checks.push(makeCheck("kideesys_columns_recognized", "warning", `Only ${mapped.length} Kid-e-Sys column(s) recognised (${Math.round(ratio * 100)}% of headers).`, unmapped.length ? `Unmapped: ${unmapped.slice(0, 12).join(", ")}` : undefined));
    }
    else {
        checks.push(makeCheck("kideesys_columns_recognized", "fail", "No known Kid-e-Sys column headers recognised in uploaded previews.", "Expected headers such as Child Name, Contact Name, Account Number, Transaction Date."));
    }
    const template = input.readinessTemplate;
    if (!template || template.systemId !== "kideesys") {
        checks.push(makeCheck("kideesys_readiness_compatibility", "warning", "Kid-e-Sys readiness template not loaded for compatibility check.", template ? `template systemId=${template.systemId}` : "No template in session"));
    }
    else {
        const categories = uploadedCategories(input.uploadedFiles);
        const requiredCategories = template.requiredFiles
            .filter((f) => f.required)
            .map((f) => f.category);
        const missing = requiredCategories.filter((c) => !categories.has(c));
        const supported = new Set(adapters_1.KIDEESYS_ADAPTER_METADATA.supportedCategories);
        const unsupportedUploaded = [...categories].filter((c) => c !== "unknown" && !supported.has(c));
        if (missing.length > 0) {
            checks.push(makeCheck("kideesys_readiness_compatibility", "fail", `Missing readiness categories for Kid-e-Sys: ${missing.join(", ")}.`, `detected=${[...categories].join(", ") || "none"}`));
        }
        else if (unsupportedUploaded.length > 0) {
            checks.push(makeCheck("kideesys_readiness_compatibility", "warning", `Required categories present; some uploads are outside adapter v1 scope: ${unsupportedUploaded.join(", ")}.`, `Adapter v1 supports: ${[...supported].join(", ")}`));
        }
        else {
            checks.push(makeCheck("kideesys_readiness_compatibility", "pass", "Uploaded file categories satisfy the Kid-e-Sys readiness template.", `categories=${[...categories].join(", ")}`));
        }
    }
    if (allColumns.length === 0) {
        checks.push(makeCheck("kideesys_normalization_confidence", "not_supported", "Normalization confidence requires column previews.", "Upload files and load previews first."));
    }
    else if (ratio >= 0.5) {
        checks.push(makeCheck("kideesys_normalization_confidence", "pass", `High normalization confidence (${Math.round(ratio * 100)}% of headers map to EduClear fields).`, `${mapped.length} mapped, ${unmapped.length} unknown`));
    }
    else if (ratio >= rules.minNormalizedColumnRatio) {
        checks.push(makeCheck("kideesys_normalization_confidence", "warning", `Moderate normalization confidence (${Math.round(ratio * 100)}%).`, "Map remaining columns manually or verify export layout."));
    }
    else {
        checks.push(makeCheck("kideesys_normalization_confidence", "fail", `Low normalization confidence (${Math.round(ratio * 100)}%).`, mapped.length
            ? `Mapped: ${mapped.map((m) => m.sourceColumn).join(", ")}`
            : "No conservative column matches — exports may not be Kid-e-Sys or use non-standard headers."));
    }
}
function appendGenericExcelAdapterChecks(checks, input) {
    const filenames = [
        ...input.uploadedFiles.map((f) => f.filename),
        ...input.previews.map((p) => p.filename),
    ].filter(Boolean);
    const allColumns = input.previews.flatMap((p) => Array.isArray(p.columns) ? p.columns.map((c) => String(c).trim()).filter(Boolean) : []);
    const detection = (0, adapters_1.evaluateGenericExcelDetection)({
        filenames,
        columns: allColumns,
        requireReadableStructure: true,
    });
    checks.push(makeCheck("generic_spreadsheet_readable", detection.detected && !detection.excludedByKnownSystem ? "pass" : "fail", detection.detected && !detection.excludedByKnownSystem
        ? "Spreadsheet structure is readable for generic import."
        : detection.excludedByKnownSystem
            ? "Another known system was detected — generic fallback is not appropriate."
            : "Spreadsheet structure is not readable with sufficient confidence.", detection.reason));
    if (allColumns.length === 0) {
        checks.push(makeCheck("generic_headers_detected", "fail", "No column headers available in previews.", "Upload files and load previews first."));
    }
    else {
        checks.push(makeCheck("generic_headers_detected", "pass", `${allColumns.length} column header(s) detected across previews.`, input.previews.map((p) => p.filename).join(", ")));
    }
    const { mapped, unmapped, ambiguous } = (0, adapters_1.normalizeGenericExcelColumns)(allColumns);
    const rules = adapters_1.GENERIC_EXCEL_CONFIDENCE_RULES;
    const ratio = (0, adapters_1.genericExcelNormalizationConfidence)(allColumns);
    const headerGroups = detection.headerGroupsMatched;
    if (allColumns.length === 0) {
        checks.push(makeCheck("generic_fields_recognized", "fail", "No headers to recognise learner/parent/billing/transaction fields.", "Load file previews before testing."));
    }
    else if (headerGroups >= rules.minHeaderGroups &&
        mapped.length >= rules.minNormalizedColumnCount) {
        checks.push(makeCheck("generic_fields_recognized", "pass", `At least one data domain recognised (${headerGroups} group(s), ${mapped.length} column(s)).`, mapped
            .slice(0, 10)
            .map((m) => `${m.sourceColumn}→${m.targetField}`)
            .join(", ")));
    }
    else if (mapped.length > 0) {
        checks.push(makeCheck("generic_fields_recognized", "warning", `Limited field recognition (${mapped.length} column(s), ${headerGroups} domain group(s)).`, unmapped.length ? `Unmapped: ${unmapped.slice(0, 8).join(", ")}` : undefined));
    }
    else {
        checks.push(makeCheck("generic_fields_recognized", "fail", "No learner/parent/billing/transaction fields recognised in headers.", "Map columns manually or verify the header row."));
    }
    if (allColumns.length === 0) {
        checks.push(makeCheck("generic_ambiguous_fields_review", "not_supported", "Ambiguous field review requires column previews."));
    }
    else if (ambiguous.length === 0) {
        checks.push(makeCheck("generic_ambiguous_fields_review", "pass", "No ambiguous generic aliases detected in headers.", `Supported categories: ${adapters_1.GENERIC_EXCEL_ADAPTER_METADATA.supportedCategories.join(", ")}`));
    }
    else {
        checks.push(makeCheck("generic_ambiguous_fields_review", "warning", `${ambiguous.length} ambiguous column(s) need manual review before staging.`, ambiguous.join(", ")));
    }
    const mappedTargets = new Set();
    for (const fileMapping of input.mappings) {
        for (const m of fileMapping.mappings) {
            const target = String(m.targetField || "").trim();
            if (target)
                mappedTargets.add(target);
        }
    }
    if (allColumns.length === 0) {
        checks.push(makeCheck("generic_mapping_confidence", "not_supported", "Mapping confidence requires column previews."));
    }
    else if (ratio >= 0.5 && mappedTargets.size >= 2) {
        checks.push(makeCheck("generic_mapping_confidence", "pass", `Acceptable mapping confidence (${Math.round(ratio * 100)}% headers, ${mappedTargets.size} targets mapped).`, `${mapped.length} normalised, ${ambiguous.length} ambiguous`));
    }
    else if (ratio >= rules.minMappingConfidenceRatio || mapped.length >= rules.minNormalizedColumnCount) {
        checks.push(makeCheck("generic_mapping_confidence", "warning", `Moderate mapping confidence (${Math.round(ratio * 100)}%).`, mappedTargets.size === 0
            ? "Confirm column mappings in the upload preview."
            : `${mappedTargets.size} target field(s) mapped in session`));
    }
    else {
        checks.push(makeCheck("generic_mapping_confidence", "fail", `Low mapping confidence (${Math.round(ratio * 100)}%).`, "Review ambiguous columns and map remaining headers manually."));
    }
}
function appendSASAMSAdapterChecks(checks, input) {
    const filenames = [
        ...input.uploadedFiles.map((f) => f.filename),
        ...input.previews.map((p) => p.filename),
    ].filter(Boolean);
    const allColumns = input.previews.flatMap((p) => Array.isArray(p.columns) ? p.columns.map((c) => String(c).trim()).filter(Boolean) : []);
    const detection = (0, adapters_1.evaluateSASAMSDetection)({ filenames, columns: allColumns });
    checks.push(makeCheck("sasams_naming_detected", detection.detected ? "pass" : "fail", detection.detected
        ? "SA-SAMS export naming or header bundle signals detected."
        : "SA-SAMS export naming not detected with sufficient confidence.", detection.reason));
    const { mapped, unmapped, administrative } = (0, adapters_1.normalizeSASAMSColumns)(allColumns);
    const rules = adapters_1.SASAMS_CONFIDENCE_RULES;
    const ratio = (0, adapters_1.sasamsNormalizationConfidence)(allColumns);
    if (allColumns.length === 0) {
        checks.push(makeCheck("sasams_columns_recognized", "fail", "No column headers available to recognise SA-SAMS fields.", "Load file previews before testing."));
    }
    else if (mapped.length >= rules.minNormalizedColumnCount &&
        ratio >= rules.minNormalizedColumnRatio) {
        checks.push(makeCheck("sasams_columns_recognized", "pass", `${mapped.length} known SA-SAMS column(s) recognised in previews.`, mapped.map((m) => `${m.sourceColumn}→${m.targetField}`).join(", ")));
    }
    else if (mapped.length > 0) {
        checks.push(makeCheck("sasams_columns_recognized", "warning", `Only ${mapped.length} SA-SAMS column(s) recognised (${Math.round(ratio * 100)}% of headers).`, unmapped.length ? `Unmapped: ${unmapped.slice(0, 12).join(", ")}` : undefined));
    }
    else {
        checks.push(makeCheck("sasams_columns_recognized", "fail", "No known SA-SAMS column headers recognised in uploaded previews.", "Expected headers such as Learner Name, Admission Number, Grade, Class, Guardian, Cell."));
    }
    const template = input.readinessTemplate;
    if (!template || template.systemId !== "sasams") {
        checks.push(makeCheck("sasams_readiness_compatibility", "warning", "SA-SAMS readiness template not loaded for compatibility check.", template ? `template systemId=${template.systemId}` : "No template in session"));
    }
    else {
        const categories = uploadedCategories(input.uploadedFiles);
        const requiredCategories = template.requiredFiles
            .filter((f) => f.required)
            .map((f) => f.category);
        const missing = requiredCategories.filter((c) => !categories.has(c));
        const supported = new Set(adapters_1.SASAMS_ADAPTER_METADATA.supportedCategories);
        const unsupportedUploaded = [...categories].filter((c) => c !== "unknown" && !supported.has(c));
        if (missing.length > 0) {
            checks.push(makeCheck("sasams_readiness_compatibility", "fail", `Missing readiness categories for SA-SAMS: ${missing.join(", ")}.`, `detected=${[...categories].join(", ") || "none"}`));
        }
        else if (unsupportedUploaded.length > 0) {
            checks.push(makeCheck("sasams_readiness_compatibility", "warning", `Required categories present; some uploads are outside adapter v1 scope: ${unsupportedUploaded.join(", ")}.`, `Adapter v1 supports: ${[...supported].join(", ")}`));
        }
        else {
            checks.push(makeCheck("sasams_readiness_compatibility", "pass", "Uploaded file categories satisfy the SA-SAMS readiness template.", `categories=${[...categories].join(", ")}`));
        }
    }
    if (allColumns.length === 0) {
        checks.push(makeCheck("sasams_normalization_confidence", "not_supported", "Normalization confidence requires column previews.", "Upload files and load previews first."));
    }
    else if (ratio >= 0.5) {
        checks.push(makeCheck("sasams_normalization_confidence", "pass", `High normalization confidence (${Math.round(ratio * 100)}% of headers map to EduClear fields).`, `${mapped.length} mapped, ${unmapped.length} unknown`));
    }
    else if (ratio >= rules.minNormalizedColumnRatio) {
        checks.push(makeCheck("sasams_normalization_confidence", "warning", `Moderate normalization confidence (${Math.round(ratio * 100)}%).`, "Map remaining columns manually or verify export layout."));
    }
    else {
        checks.push(makeCheck("sasams_normalization_confidence", "fail", `Low normalization confidence (${Math.round(ratio * 100)}%).`, mapped.length
            ? `Mapped: ${mapped.map((m) => m.sourceColumn).join(", ")}`
            : "No conservative column matches — exports may not be SA-SAMS or use non-standard headers."));
    }
    if (allColumns.length === 0) {
        checks.push(makeCheck("sasams_administrative_identifiers", "not_supported", "Administrative identifier check requires column previews.", "Upload files and load previews first."));
    }
    else if (administrative.length > 0) {
        checks.push(makeCheck("sasams_administrative_identifiers", "pass", `${administrative.length} administrative column(s) recognised (EMIS, admission, or register fields).`, administrative.join(", ")));
    }
    else {
        checks.push(makeCheck("sasams_administrative_identifiers", "warning", "No EMIS, admission number, register number, or admission date columns detected.", "Administrative fields are optional but improve learner matching when present."));
    }
}
/**
 * Read-only adapter test harness — uses universal migration session payload only.
 * No staging, apply, or school table writes.
 */
function testMigrationAdapter(input) {
    const systemId = String(input.systemId || "").trim();
    const uploadedFiles = Array.isArray(input.uploadedFiles) ? input.uploadedFiles : [];
    const previews = Array.isArray(input.previews) ? input.previews : [];
    const mappings = Array.isArray(input.mappings) ? input.mappings : [];
    const validationSummary = input.validationSummary ?? null;
    const readinessTemplate = input.readinessTemplate ?? null;
    const checks = [];
    const adapter = (0, resolveMigrationAdapter_1.getMigrationAdapterForSystem)(systemId);
    if (adapter) {
        checks.push(makeCheck("adapter_exists", "pass", `Adapter "${adapter.source}" is registered for system ${systemId}.`, `source=${adapter.source}`));
    }
    else {
        checks.push(makeCheck("adapter_exists", "fail", `No migration adapter registered for system "${systemId}".`, "Add or map an adapter in MIGRATION_ADAPTERS before staging."));
    }
    if (readinessTemplate) {
        checks.push(makeCheck("readiness_template_available", "pass", `Readiness template v${readinessTemplate.version} loaded.`, readinessTemplate.templateId));
    }
    else {
        checks.push(makeCheck("readiness_template_available", "warning", "No readiness template on file for this system.", "Upload guidance and file/field expectations are limited without a template."));
    }
    const categories = uploadedCategories(uploadedFiles);
    if (!readinessTemplate) {
        checks.push(makeCheck("expected_files_present", "not_supported", "Cannot verify expected files without a readiness template.", "Provide readinessTemplate in the test request or load it from the registry."));
    }
    else {
        const missingRequired = [];
        for (const file of readinessTemplate.requiredFiles) {
            if (!file.required)
                continue;
            if (!categories.has(file.category)) {
                missingRequired.push(`${file.label} (${file.category})`);
            }
        }
        if (missingRequired.length === 0) {
            checks.push(makeCheck("expected_files_present", "pass", "All required file categories from the readiness template are present in uploads.", `categories=${[...categories].join(", ")}`));
        }
        else {
            checks.push(makeCheck("expected_files_present", "fail", `Missing required upload categories: ${missingRequired.join("; ")}.`, `detected=${[...categories].join(", ") || "none"}`));
        }
    }
    if (!readinessTemplate) {
        checks.push(makeCheck("required_fields_mapped", "not_supported", "Cannot verify required field mappings without a readiness template."));
    }
    else {
        const mappedTargetsByCategory = new Map();
        for (const fileMapping of mappings) {
            const file = uploadedFiles.find((f) => f.id === fileMapping.fileId);
            const category = file?.category ?? "unknown";
            const targets = mappedTargetsByCategory.get(category) ?? new Set();
            for (const m of fileMapping.mappings) {
                const target = String(m.targetField || "").trim();
                if (target)
                    targets.add(target);
            }
            mappedTargetsByCategory.set(category, targets);
        }
        const missingFields = [];
        for (const field of readinessTemplate.requiredFields) {
            if (!field.required)
                continue;
            if (!categories.has(field.category))
                continue;
            const targets = mappedTargetsByCategory.get(field.category) ?? new Set();
            if (!(0, kidESysReadinessRequiredFields_1.isReadinessRequiredFieldMapped)(readinessTemplate.systemId, field, targets)) {
                missingFields.push(`${field.label} → ${field.targetField}`);
            }
        }
        if (missingFields.length === 0) {
            checks.push(makeCheck("required_fields_mapped", mappings.length > 0 ? "pass" : "warning", mappings.length > 0
                ? "Required readiness fields are mapped for uploaded categories."
                : "No column mappings in session yet — required fields cannot be confirmed.", mappings.length > 0 ? undefined : "Run mapping suggestions or load a template."));
        }
        else {
            checks.push(makeCheck("required_fields_mapped", "fail", `Unmapped required fields: ${missingFields.join("; ")}.`, "Map columns in the upload preview before staging."));
        }
    }
    if (previews.length === 0) {
        checks.push(makeCheck("preview_available", "fail", "No file previews in session.", "Upload files and load previews first."));
    }
    else {
        const emptyColumns = previews.filter((p) => !Array.isArray(p.columns) || p.columns.length === 0);
        if (emptyColumns.length > 0) {
            checks.push(makeCheck("preview_available", "warning", `${emptyColumns.length} preview(s) have no detected columns.`, emptyColumns.map((p) => p.filename).join(", ")));
        }
        else {
            checks.push(makeCheck("preview_available", "pass", `${previews.length} file preview(s) loaded with column headers.`, previews.map((p) => p.filename).join(", ")));
        }
    }
    if (!validationSummary) {
        checks.push(makeCheck("full_validation_available", "warning", "Validation has not been run in this session.", "Run full-file validation before staging."));
    }
    else if (validationSummary.mode === "full") {
        const detail = validationSummary.errors > 0
            ? `${validationSummary.errors} error(s), ${validationSummary.warnings} warning(s)`
            : validationSummary.canProceed
                ? "canProceed=true"
                : `${validationSummary.warnings} warning(s)`;
        checks.push(makeCheck("full_validation_available", validationSummary.errors > 0 ? "warning" : "pass", validationSummary.errors > 0
            ? "Full-file validation completed with blocking errors."
            : "Full-file validation completed.", detail));
    }
    else {
        checks.push(makeCheck("full_validation_available", "warning", "Only preview validation has been run.", "Switch to full-file validation before staging."));
    }
    const savedTemplates = (0, migrationTemplateStore_1.listTemplates)().filter((t) => String(t.sourceSystem || "").trim() === systemId);
    if (savedTemplates.length > 0) {
        checks.push(makeCheck("template_mappings_available", "pass", `${savedTemplates.length} saved mapping template(s) for this system.`, savedTemplates.map((t) => t.name).join(", ")));
    }
    else {
        checks.push(makeCheck("template_mappings_available", "warning", "No saved mapping templates for this system.", "Save a template after mapping columns to reuse on future imports."));
    }
    if (!hasTransactionFiles(uploadedFiles, previews, mappings)) {
        checks.push(makeCheck("transaction_readiness_available", "not_supported", "No transaction files or transaction field mappings in this session."));
    }
    else if (previews.length === 0 || mappings.length === 0) {
        checks.push(makeCheck("transaction_readiness_available", "fail", "Transaction files detected but previews or mappings are missing.", "Load previews and map transaction columns before testing."));
    }
    else {
        const rowsByFileId = new Map();
        for (const preview of previews) {
            rowsByFileId.set(preview.fileId, preview.sampleRows ?? []);
        }
        const counts = (0, computeTransactionReadiness_1.computeTransactionReadiness)({
            previews,
            mappings,
            rowsByFileId,
            cutoverDate: null,
        });
        const total = counts.historicalOnlyTransactions +
            counts.eligibleActiveTransactions +
            counts.blockedTransactions +
            counts.unmatchedTransactions;
        if (total === 0) {
            checks.push(makeCheck("transaction_readiness_available", "warning", "Transaction readiness could not classify any rows from preview samples.", "Run full-file validation or ensure transaction date/amount columns are mapped."));
        }
        else {
            checks.push(makeCheck("transaction_readiness_available", counts.blockedTransactions > 0 || counts.unmatchedTransactions > 0 ? "warning" : "pass", `Transaction readiness computed on preview sample (${total} row(s) classified).`, [
                `historical=${counts.historicalOnlyTransactions}`,
                `eligibleActive=${counts.eligibleActiveTransactions}`,
                `blocked=${counts.blockedTransactions}`,
                `unmatched=${counts.unmatchedTransactions}`,
            ].join(", ")));
        }
    }
    if (systemId === "kideesys") {
        appendKidESysAdapterChecks(checks, {
            uploadedFiles,
            previews,
            readinessTemplate,
        });
    }
    if (systemId === "sasams") {
        appendSASAMSAdapterChecks(checks, {
            uploadedFiles,
            previews,
            readinessTemplate,
        });
    }
    if (isGenericExcelSystemId(systemId)) {
        appendGenericExcelAdapterChecks(checks, {
            uploadedFiles,
            previews,
            mappings,
        });
    }
    const overallStatus = deriveOverallStatus(checks);
    const recommendation = deriveRecommendation(overallStatus, checks);
    const partitioned = partitionChecks(checks);
    return {
        systemId,
        testedAt: new Date().toISOString(),
        overallStatus,
        recommendation,
        checks,
        ...partitioned,
    };
}
