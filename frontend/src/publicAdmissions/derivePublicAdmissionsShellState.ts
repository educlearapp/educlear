import type {
  PublicAdmissionsConfig,
  PublicAdmissionsShellState,
} from "./publicAdmissionsTypes";

export function derivePublicAdmissionsShellState(input: {
  loading: boolean;
  notFound: boolean;
  error: boolean;
  config: PublicAdmissionsConfig | null;
  now?: Date;
}): PublicAdmissionsShellState {
  if (input.loading) return "LOADING";
  if (input.notFound) return "NOT_FOUND";
  if (input.error || !input.config) return "ERROR";

  const config = input.config;
  if (config.acceptingApplications) return "OPEN";
  if (!config.enabled) return "DISABLED";

  const now = input.now || new Date();
  const openAt = config.applicationsOpenAt ? new Date(config.applicationsOpenAt) : null;
  const closeAt = config.applicationsCloseAt ? new Date(config.applicationsCloseAt) : null;

  if (openAt && !Number.isNaN(openAt.getTime()) && now < openAt) {
    return "CLOSED_BEFORE_WINDOW";
  }
  if (closeAt && !Number.isNaN(closeAt.getTime()) && now > closeAt) {
    return "CLOSED_AFTER_WINDOW";
  }
  return "CLOSED";
}

export function canStartPublicApplication(state: PublicAdmissionsShellState): boolean {
  return state === "OPEN";
}

export function formatAdmissionFeeSummary(config: PublicAdmissionsConfig): string | null {
  if (!config.admissionFeeRequired) return null;
  const amount = String(config.admissionFeeAmount || "").trim();
  const currency = String(config.currency || "ZAR").trim() || "ZAR";
  if (!amount) return `Required (${currency})`;
  if (currency.toUpperCase() === "ZAR") return `R${amount}`;
  return `${currency} ${amount}`;
}

export function formatPublicDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
