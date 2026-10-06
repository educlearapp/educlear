/**
 * Manage Learner General tab — real controlled-input regression test.
 * Renders the actual ManageLearner component in jsdom, types into the inputs and saves.
 * Run: TSX_TSCONFIG_PATH=tsconfig.app.json node --import tsx src/learner/ManageLearner.controlledInput.test.ts
 */
import { createRequire, register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      "export async function load(url, context, next) {" +
        " if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };" +
        " return next(url, context); }"
    )
);

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const g = globalThis as any;
g.window = dom.window;
g.document = dom.window.document;
g.localStorage = dom.window.localStorage;
g.HTMLElement = dom.window.HTMLElement;
g.HTMLInputElement = dom.window.HTMLInputElement;
g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
g.HTMLSelectElement = dom.window.HTMLSelectElement;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.MouseEvent = dom.window.MouseEvent;
g.getComputedStyle = dom.window.getComputedStyle;
g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
if (!g.navigator) g.navigator = dom.window.navigator;
g.IS_REACT_ACT_ENVIRONMENT = true;

const LEARNER_ID = "test-learner-1";
type StoredLearner = Record<string, unknown>;
const store: { learner: StoredLearner; puts: Array<{ url: string; body: any }> } = {
  learner: {
    id: LEARNER_ID,
    schoolId: "test-school",
    firstName: "Yaone",
    lastName: "Dire",
    idNumber: "1905045800085",
    birthDate: "2019-05-04",
    gender: "Female",
    grade: "Grade R",
    className: "Grade RA",
    homeLanguage: "English",
    nationality: "South African",
    religion: "",
    admissionDate: "2024-01-15",
    enrolmentDate: "2024-01-15",
    notes: "Original note",
    admissionNo: "DIR001",
    enrollmentStatus: "ACTIVE",
    parents: [],
    billingPlan: [],
  },
  puts: [],
};

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

g.fetch = async (input: unknown, init: RequestInit = {}) => {
  const url = String(input);
  const method = String(init.method || "GET").toUpperCase();
  const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : null;
  if (url.endsWith(`/api/learners/${LEARNER_ID}/sensitive-fields`)) {
    return jsonResponse(
      method === "PUT"
        ? { allergies: body?.allergies ?? null, medicalAlert: body?.medicalAlert ?? null }
        : { allergies: null, medicalAlert: null, parents: [] }
    );
  }
  if (url.endsWith(`/api/learners/${LEARNER_ID}`)) {
    if (method === "PUT") {
      store.puts.push({ url, body });
      store.learner = { ...store.learner, ...body };
      return jsonResponse({ success: true, learner: store.learner });
    }
    return jsonResponse({ success: true, learner: { ...store.learner }, billingPlan: [] });
  }
  return jsonResponse({ success: true, data: [], learners: [], parents: [] });
};

const alerts: string[] = [];
dom.window.alert = (message: string) => {
  alerts.push(String(message));
};
g.alert = dom.window.alert;

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

async function main() {
  const React = await import("react");
  const { act } = React;
  const { createRoot } = await import("react-dom/client");
  const { default: ManageLearner } = await import("./ManageLearner");

  const flush = async (ms = 0) => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  };

  function Harness() {
    const [selectedLearner, setSelectedLearner] = React.useState<any | null>({ ...store.learner });
    const [, setLearners] = React.useState<any[]>([]);
    const [parents, setParents] = React.useState<any[]>([]);
    return React.createElement(ManageLearner, {
      learner: selectedLearner,
      setLearner: setSelectedLearner,
      setLearners,
      parents,
      setParents,
      onBack: () => {},
    });
  }

  let container = document.getElementById("root")!;
  let root: ReturnType<typeof createRoot>;

  const mount = async () => {
    localStorage.removeItem("selectedLearnerForManage");
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(React.StrictMode, null, React.createElement(Harness)));
    });
    await flush(20);
  };

  const unmount = async () => {
    await act(async () => root.unmount());
  };

  const fieldByLabel = (label: string) => {
    const labels = Array.from(container.querySelectorAll("label"));
    const labelEl = labels.find((l) => (l.textContent || "").replace(/\s+/g, " ").trim() === label);
    assert(Boolean(labelEl), `label "${label}" not found`);
    const control = labelEl!.nextElementSibling as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    assert(Boolean(control), `control for "${label}" not found`);
    return control;
  };
  const valueOf = (label: string) => fieldByLabel(label).value;

  const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) => {
    const proto =
      el instanceof dom.window.HTMLTextAreaElement
        ? dom.window.HTMLTextAreaElement.prototype
        : el instanceof dom.window.HTMLSelectElement
          ? dom.window.HTMLSelectElement.prototype
          : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  };

  /** Types one character at a time, asserting the visible value after every keystroke. */
  const typeInto = async (label: string, text: string, { replace = false } = {}) => {
    if (replace) {
      const el = fieldByLabel(label);
      await act(async () => {
        setNativeValue(el, "");
        el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      assert(valueOf(label) === "", `${label}: clearing did not empty the field`);
    }
    for (const ch of text) {
      const el = fieldByLabel(label);
      const expected = el.value + ch;
      await act(async () => {
        setNativeValue(el, expected);
        el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await flush();
      assert(
        valueOf(label) === expected,
        `${label}: after typing "${ch}" expected "${expected}" but field shows "${valueOf(label)}"`
      );
    }
  };

  const selectOption = async (label: string, value: string) => {
    const el = fieldByLabel(label);
    await act(async () => {
      setNativeValue(el, value);
      el.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
    await flush();
  };

  const clickButton = async (text: string) => {
    const button = Array.from(container.querySelectorAll("button")).find((b) =>
      (b.textContent || "").includes(text)
    );
    assert(Boolean(button), `button "${text}" not found`);
    await act(async () => {
      button!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    await flush(20);
  };

  await mount();

  await test("existing learner values render in the General tab", async () => {
    assert(valueOf("* Name / Nickname") === "Yaone", `name: ${valueOf("* Name / Nickname")}`);
    assert(valueOf("* Surname") === "Dire", `surname: ${valueOf("* Surname")}`);
    assert(valueOf("ID No") === "1905045800085", `id: ${valueOf("ID No")}`);
    assert(valueOf("* Birth Date") === "2019-05-04", `dob: ${valueOf("* Birth Date")}`);
    assert(valueOf("Gender") === "Female", `gender: ${valueOf("Gender")}`);
    assert(valueOf("Classroom") === "Grade RA", `classroom: ${valueOf("Classroom")}`);
    assert(valueOf("Notes") === "Original note", `notes: ${valueOf("Notes")}`);
    const accountNo = fieldByLabel("Account No") as HTMLInputElement;
    assert(accountNo.readOnly && accountNo.value === "DIR001", "account no stays read-only");
  });

  await test("name: replaced text shows immediately on every keystroke, spaces included", async () => {
    await typeInto("* Name / Nickname", "Ann Marie", { replace: true });
    assert(valueOf("* Name / Nickname") === "Ann Marie", "name not replaced");
  });

  await test("surname: typing works and does not reset the edited name", async () => {
    await typeInto("* Surname", "Van Wyk", { replace: true });
    assert(valueOf("* Surname") === "Van Wyk", "surname not replaced");
    assert(valueOf("* Name / Nickname") === "Ann Marie", "editing surname reset the name");
  });

  await test("ID number: typing works and still fills birth date from a valid SA ID", async () => {
    await typeInto("ID No", "1806125800087", { replace: true });
    assert(valueOf("* Birth Date") === "2018-06-12", `dob not derived: ${valueOf("* Birth Date")}`);
    assert(valueOf("* Name / Nickname") === "Ann Marie", "editing ID reset the name");
  });

  await test("gender, classroom and other text fields are editable without resetting others", async () => {
    await selectOption("Gender", "Male");
    assert(valueOf("Gender") === "Male", "gender not changed");
    await typeInto("Classroom", "Grade RB", { replace: true });
    await typeInto("Home Language", "Setswana", { replace: true });
    await typeInto("Nationality", "Motswana", { replace: true });
    await typeInto("Religion", "Christian");
    await typeInto("Notes", " - updated");
    assert(valueOf("* Name / Nickname") === "Ann Marie", "name was reset");
    assert(valueOf("* Surname") === "Van Wyk", "surname was reset");
    assert(valueOf("ID No") === "1806125800087", "ID was reset");
    assert(valueOf("Gender") === "Male", "gender was reset");
  });

  await test("Save sends the edited values in the PUT payload", async () => {
    store.puts.length = 0;
    await clickButton("Save");
    const put = store.puts.find((p) => p.url.endsWith(`/api/learners/${LEARNER_ID}`));
    assert(Boolean(put), "no learner PUT was sent");
    const body = put!.body;
    assert(body.firstName === "Ann Marie", `firstName: ${body.firstName}`);
    assert(body.lastName === "Van Wyk", `lastName: ${body.lastName}`);
    assert(body.idNumber === "1806125800087", `idNumber: ${body.idNumber}`);
    assert(body.birthDate === "2018-06-12", `birthDate: ${body.birthDate}`);
    assert(body.gender === "Male", `gender: ${body.gender}`);
    assert(body.className === "Grade RB", `className: ${body.className}`);
    assert(body.homeLanguage === "Setswana", `homeLanguage: ${body.homeLanguage}`);
    assert(body.nationality === "Motswana", `nationality: ${body.nationality}`);
    assert(body.religion === "Christian", `religion: ${body.religion}`);
    assert(body.notes === "Original note - updated", `notes: ${body.notes}`);
    assert(body.enrolmentDate === "2024-01-15", `enrolmentDate kept: ${body.enrolmentDate}`);
    assert(alerts.includes("Learner saved successfully"), `alerts: ${alerts.join(" | ")}`);
  });

  await test("reloaded learner shows the saved values", async () => {
    await unmount();
    await mount();
    assert(valueOf("* Name / Nickname") === "Ann Marie", `name: ${valueOf("* Name / Nickname")}`);
    assert(valueOf("* Surname") === "Van Wyk", `surname: ${valueOf("* Surname")}`);
    assert(valueOf("ID No") === "1806125800087", `id: ${valueOf("ID No")}`);
    assert(valueOf("* Birth Date") === "2018-06-12", `dob: ${valueOf("* Birth Date")}`);
    assert(valueOf("Gender") === "Male", `gender: ${valueOf("Gender")}`);
    assert(valueOf("Classroom") === "Grade RB", `classroom: ${valueOf("Classroom")}`);
    assert(valueOf("Home Language") === "Setswana", `language: ${valueOf("Home Language")}`);
    assert(valueOf("Nationality") === "Motswana", `nationality: ${valueOf("Nationality")}`);
    assert(valueOf("Notes") === "Original note - updated", `notes: ${valueOf("Notes")}`);
  });

  await unmount();
  console.log(`ManageLearner.controlledInput: ${passed} passed`);
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
