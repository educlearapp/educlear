/** Single source column → EduClear target field rule (mapping rules only, no row data). */
export type MigrationTemplateMappingRule = {
  sourceColumn: string;
  targetField: string;
};

/** Reusable column mapping template per legacy source system (Super Admin, JSON file storage). */
export type MigrationMappingTemplate = {
  id: string;
  name: string;
  sourceSystem: string;
  description: string;
  mappings: MigrationTemplateMappingRule[];
  createdAt: string;
  updatedAt: string;
};
