export type MigrationRunbookStepStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked";

export type MigrationRunbookOverallStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "blocked";

export type MigrationRunbookStep = {
  stepId: string;
  title: string;
  description: string;
  status: MigrationRunbookStepStatus;
  required: boolean;
  notes: string;
};

export type MigrationRunbook = {
  runbookId: string;
  schoolId: string;
  schoolName: string;
  sourceSystem: string;
  createdAt: string;
  steps: MigrationRunbookStep[];
  overallStatus: MigrationRunbookOverallStatus;
  pilotId: string;
  notes: string;
};

export type MigrationRunbookCreateInput = {
  schoolId: string;
  schoolName: string;
  sourceSystem?: string;
  pilotId?: string;
  notes?: string;
};

export type MigrationRunbookStepPatch = {
  stepId: string;
  status?: MigrationRunbookStepStatus;
  notes?: string;
};

export type MigrationRunbookPatch = {
  steps?: MigrationRunbookStepPatch[];
  notes?: string;
  pilotId?: string | null;
};
