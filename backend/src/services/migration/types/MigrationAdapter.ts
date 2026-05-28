/**
 * Universal migration adapter contract — source-agnostic pipeline stages.
 * Implementations live under `adapters/`; orchestration under `core/`.
 */
export interface MigrationAdapter {
  /** Canonical source key (e.g. kideesys, sasams, generic-excel). */
  source: string;

  detect(files: string[]): Promise<boolean>;

  parse(files: string[]): Promise<unknown>;

  map(data: unknown): Promise<unknown>;

  validate(mapped: unknown): Promise<unknown>;

  stage(validated: unknown): Promise<unknown>;
}
