"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.genericCsvAdapter = exports.GENERIC_CSV_ADAPTER_METADATA = void 0;
const migrationLearnerFileParser_1 = require("../../../utils/migrationLearnerFileParser");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const genericExcelNormalization_1 = require("./genericExcelNormalization");
exports.GENERIC_CSV_ADAPTER_METADATA = {
    id: "generic-csv",
    label: "Generic CSV",
    description: "Comma-separated exports and manual CSV templates",
};
function detectCsvFiles(files) {
    return files.some((f) => /\.csv$/i.test(String(f || "")));
}
exports.genericCsvAdapter = {
    source: "generic-csv",
    async detect(files) {
        return detectCsvFiles(files);
    },
    async parse(files) {
        const out = [];
        for (const filePath of files) {
            const buffer = await promises_1.default.readFile(filePath);
            const parsed = (0, migrationLearnerFileParser_1.parseMigrationLearnerFileBuffer)(buffer, path_1.default.basename(filePath));
            out.push({ path: filePath, rows: parsed.rows });
        }
        return { files: out };
    },
    async map(data) {
        const parsed = data;
        const mappings = [];
        const first = parsed.files[0]?.rows[0];
        if (!first)
            return { mappings };
        for (const col of Object.keys(first)) {
            const target = (0, genericExcelNormalization_1.normalizeGenericExcelColumn)(col);
            if (target)
                mappings.push({ sourceColumn: col, targetField: target });
        }
        return { mappings };
    },
    async validate(mapped) {
        const m = mapped;
        return { ok: Array.isArray(m.mappings) && m.mappings.length > 0 };
    },
    async stage(validated) {
        return validated;
    },
};
