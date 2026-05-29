"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Verify fresh Da Silva Academy: login, empty data, migration center.
 *
 *   npx tsx scripts/verify-fresh-da-silva-school.ts
 */
require("dotenv/config");
const API_BASE = String(process.env.API_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const EMAIL = "dasilvaacademy@gmail.com";
const PASSWORD = "Tmjs0407@";
const checks = [];
function record(name, ok, detail) {
    checks.push({ name, ok, detail });
}
async function main() {
    const loginRes = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    const loginBody = (await loginRes.json().catch(() => ({})));
    const token = String(loginBody.token || "");
    const schoolId = String(loginBody.school?.id || "");
    record("Login", loginRes.status === 200 && Boolean(token), loginRes.status === 200
        ? `200 — school=${loginBody.school?.name} role=${loginBody.user?.role}`
        : `${loginRes.status} — ${loginBody.error || "no token"}`);
    if (!token || !schoolId) {
        printReport();
        process.exit(1);
        return;
    }
    const auth = { Authorization: `Bearer ${token}` };
    const q = `schoolId=${encodeURIComponent(schoolId)}`;
    const learnersRes = await fetch(`${API_BASE}/api/registrations/learners?${q}`, { headers: auth });
    const learnersBody = (await learnersRes.json().catch(() => []));
    const learnerList = Array.isArray(learnersBody)
        ? learnersBody
        : Array.isArray(learnersBody?.learners)
            ? learnersBody.learners
            : [];
    record("Registrations learners", learnersRes.status === 200 && learnerList.length === 0, `${learnersRes.status} — count=${learnerList.length}`);
    const statementsRes = await fetch(`${API_BASE}/api/statements?${q}`, { headers: auth });
    const statementsBody = (await statementsRes.json().catch(() => ({})));
    const statementRows = Array.isArray(statementsBody)
        ? statementsBody
        : Array.isArray(statementsBody.statements)
            ? statementsBody.statements
            : Array.isArray(statementsBody.entries)
                ? statementsBody.entries
                : [];
    record("Statements", statementsRes.status === 200 && statementRows.length === 0, `${statementsRes.status} — rows=${statementRows.length}`);
    const paymentsRes = await fetch(`${API_BASE}/api/payments?${q}`, { headers: auth });
    const paymentsBody = (await paymentsRes.json().catch(() => ({})));
    const paymentRows = Array.isArray(paymentsBody)
        ? paymentsBody
        : Array.isArray(paymentsBody.payments)
            ? paymentsBody.payments
            : [];
    record("Payments", paymentsRes.status === 200 && paymentRows.length === 0, `${paymentsRes.status} — rows=${paymentRows.length}`);
    const migrationRes = await fetch(`${API_BASE}/api/super-admin/migration/target-schools`, {
        headers: auth,
    });
    const migrationBody = (await migrationRes.json().catch(() => ({})));
    const schools = migrationBody.schools || [];
    const hasDaSilva = schools.some((s) => String(s.name || "")
        .toLowerCase()
        .includes("da silva"));
    const daSilvaProjectRes = await fetch(`${API_BASE}/api/super-admin/migration/da-silva/projects`, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ schoolId }),
    });
    const daSilvaProjectBody = (await daSilvaProjectRes.json().catch(() => ({})));
    record("Migration Center (target-schools)", migrationRes.status === 200 && schools.length > 0 && hasDaSilva, `${migrationRes.status} — schools=${schools.length}, daSilvaListed=${hasDaSilva}`);
    record("Migration Center (da-silva project)", daSilvaProjectRes.status === 200 && daSilvaProjectBody.success === true, `${daSilvaProjectRes.status} — projectId=${daSilvaProjectBody.projectId || "(none)"}`);
    printReport();
    if (!checks.every((c) => c.ok))
        process.exit(1);
}
function printReport() {
    console.log("\n=== Fresh Da Silva verification ===");
    console.log(`API: ${API_BASE}`);
    console.log(`Login email: ${EMAIL}`);
    for (const c of checks) {
        console.log(`${c.ok ? "PASS" : "FAIL"} — ${c.name}: ${c.detail}`);
    }
}
main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
});
