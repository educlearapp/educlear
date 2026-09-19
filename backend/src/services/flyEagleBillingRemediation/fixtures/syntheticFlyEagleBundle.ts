/**
 * Synthetic Fly Eagle-shaped fixtures for remediation tests.
 * Patterns: sibling share, orphan historical, split ledger, historical learner,
 * retired predecessor, duplicate shell, wrong-FA with parent proof, ambiguous C.
 */
import { FLY_EAGLE_SCHOOL_ID } from "../constants";
import type { FlyEagleSchoolBundle } from "../types";

const SID = FLY_EAGLE_SCHOOL_ID;

export function buildSyntheticFlyEagleBundle(): FlyEagleSchoolBundle {
  return {
    schoolId: SID,
    schoolName: "Fly Eagle Primary School (synthetic)",
    capturedAt: "2026-09-19T12:00:00.000Z",
    familyAccounts: [
      // Current sibling FA (MAN005 pattern)
      {
        id: "fa-man005",
        schoolId: SID,
        accountRef: "MANXILA MIBONGO",
        accountNo: "MAN005",
        familyName: "MANXILA",
        createdAt: "2026-08-24T22:00:00.000Z",
      },
      // Orphan historical with ledger (MAN009) — wrong FA / split
      {
        id: "fa-man009",
        schoolId: SID,
        accountRef: "MANXILA SIMBONGO",
        accountNo: "MAN009",
        familyName: "MANXILA",
        createdAt: "2026-08-24T22:00:00.000Z",
      },
      // Historical learner account (ADD001)
      {
        id: "fa-add001",
        schoolId: SID,
        accountRef: "GROOM ADEBO",
        accountNo: "ADD001",
        familyName: "GROOM",
        createdAt: "2026-08-24T22:00:00.000Z",
      },
      // Duplicate empty shell
      {
        id: "fa-empty-shell",
        schoolId: SID,
        accountRef: "EMPTY SHELL TEST",
        accountNo: "EMP001",
        familyName: "EMPTY",
        createdAt: "2026-08-24T22:00:00.000Z",
      },
      // SOT current + orphan with parent proof (Class A candidate)
      {
        id: "fa-sot002",
        schoolId: SID,
        accountRef: "SOTSHANGANE LULONKE CURRENT",
        accountNo: "SOT002",
        familyName: "SOTSHANGANE",
        createdAt: "2026-08-25T10:00:00.000Z",
      },
      {
        id: "fa-sot001",
        schoolId: SID,
        accountRef: "SOTSHANGANE LULONKE",
        accountNo: "SOT001",
        familyName: "SOTSHANGANE",
        createdAt: "2026-08-24T22:00:00.000Z",
      },
      // Retired predecessor
      {
        id: "fa-mayishe-retired",
        schoolId: SID,
        accountRef: "MAYISHE OMIYO",
        accountNo: "MAY001",
        familyName: "MAYISHE",
        createdAt: "2026-08-24T22:00:00.000Z",
        retiredAt: "2026-09-15T10:18:48.401Z",
        mergedIntoFamilyAccountId: "fa-sot001",
      },
      // Ambiguous unresolved orphan
      {
        id: "fa-unresolved",
        schoolId: SID,
        accountRef: "BOTLHOKO ORATILE PEARL",
        accountNo: null,
        familyName: "BOTLHOKO",
        createdAt: "2026-08-24T22:00:00.000Z",
      },
      // Other school must never appear — intentionally omitted
    ],
    learners: [
      {
        id: "lrn-mibongo",
        schoolId: SID,
        firstName: "Mibongo",
        lastName: "MANXILA",
        enrollmentStatus: "ACTIVE",
        className: "Grade 3A",
        grade: "3",
        familyAccountId: "fa-man005",
        admissionNo: "MAN005-A",
        createdAt: "2026-08-24T22:10:00.000Z",
      },
      {
        id: "lrn-simbonge",
        schoolId: SID,
        firstName: "Simbonge",
        lastName: "MANXILA",
        enrollmentStatus: "ACTIVE",
        className: "Grade 1B",
        grade: "1",
        familyAccountId: "fa-man005",
        admissionNo: "MAN005-B",
        createdAt: "2026-08-24T22:10:00.000Z",
      },
      {
        id: "lrn-groom-hist",
        schoolId: SID,
        firstName: "Groom",
        lastName: "Addebo",
        enrollmentStatus: "HISTORICAL",
        className: "",
        grade: "7",
        familyAccountId: null,
        admissionNo: "ADD001",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "lrn-lulonke",
        schoolId: SID,
        firstName: "Lulonke",
        lastName: "SOTSHANGANE",
        enrollmentStatus: "ACTIVE",
        className: "Grade 2",
        grade: "2",
        familyAccountId: "fa-sot002",
        admissionNo: "SOT002",
        createdAt: "2026-08-25T10:05:00.000Z",
      },
    ],
    parents: [
      {
        id: "par-manxila",
        schoolId: SID,
        familyAccountId: "fa-man005",
        firstName: "Parent",
        surname: "Manxila",
        cellNo: "0821112233",
        email: "manxila@example.com",
        idNumber: "8001015009087",
      },
      // Same phone on orphan FA → parent proof for MAN009
      {
        id: "par-manxila-orphan",
        schoolId: SID,
        familyAccountId: "fa-man009",
        firstName: "Parent",
        surname: "Manxila",
        cellNo: "0821112233",
        email: "manxila@example.com",
        idNumber: "8001015009087",
      },
      {
        id: "par-sot",
        schoolId: SID,
        familyAccountId: "fa-sot002",
        firstName: "Xolisile",
        surname: "MAYISHE",
        cellNo: "0839998877",
        email: "mayishe@example.com",
        idNumber: "8502025009088",
      },
      {
        id: "par-sot-orphan",
        schoolId: SID,
        familyAccountId: "fa-sot001",
        firstName: "Xolisile",
        surname: "MAYISHE",
        cellNo: "0839998877",
        email: "mayishe@example.com",
        idNumber: "8502025009088",
      },
    ],
    parentLearnerLinks: [
      { parentId: "par-manxila", learnerId: "lrn-mibongo", schoolId: SID },
      { parentId: "par-manxila", learnerId: "lrn-simbonge", schoolId: SID },
      { parentId: "par-sot", learnerId: "lrn-lulonke", schoolId: SID },
    ],
    ledger: [
      // MAN009 orphan ledger
      { type: "invoice", accountNo: "MANXILA SIMBONGO", amount: 1400, schoolId: SID },
      { type: "payment", accountNo: "MANXILA SIMBONGO", amount: 200, schoolId: SID },
      // MAN005 current also has ledger → split
      { type: "invoice", accountNo: "MANXILA MIBONGO", amount: 500, schoolId: SID },
      // ADD001 historical
      { type: "invoice", accountNo: "GROOM ADEBO", amount: 1350, schoolId: SID },
      { type: "payment", accountNo: "GROOM ADEBO", amount: 1350, schoolId: SID },
      // unresolved tiny ledger
      { type: "invoice", accountNo: "BOTLHOKO ORATILE PEARL", amount: 100, schoolId: SID },
      { type: "payment", accountNo: "BOTLHOKO ORATILE PEARL", amount: 100, schoolId: SID },
    ],
    ageAnalysisByRef: {
      "MANXILA SIMBONGO": { accountRef: "MANXILA SIMBONGO", balance: 1200 },
      "MANXILA MIBONGO": { accountRef: "MANXILA MIBONGO", balance: 500 },
      "GROOM ADEBO": { accountRef: "GROOM ADEBO", balance: 0 },
      "SOTSHANGANE LULONKE": { accountRef: "SOTSHANGANE LULONKE", balance: 0 },
      "SOTSHANGANE LULONKE CURRENT": { accountRef: "SOTSHANGANE LULONKE CURRENT", balance: 0 },
      "BOTLHOKO ORATILE PEARL": { accountRef: "BOTLHOKO ORATILE PEARL", balance: 0 },
      "EMPTY SHELL TEST": { accountRef: "EMPTY SHELL TEST", balance: 0 },
    },
    audit: [
      {
        action: "merge",
        sourceAccountRef: "MAYISHE OMIYO",
        targetAccountRef: "SOTSHANGANE LULONKE",
        createdAt: "2026-09-15T10:18:48.401Z",
      },
    ],
  };
}

/** Different school id — repair must refuse. */
export function buildOtherSchoolBundle(): FlyEagleSchoolBundle {
  const b = buildSyntheticFlyEagleBundle();
  return {
    ...b,
    schoolId: "cmpideqeq0000108xb6ouv9zi",
    schoolName: "Da Silva Academy (must not be touched)",
  };
}
