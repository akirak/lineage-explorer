import { schema as s } from './schema.ts';

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
const cl = s.columnLineage;

export const graphQueries = {
  jobs: `
    SELECT ${q(s.job.namespace)} AS namespace, ${q(s.job.name)} AS name
    FROM ${q(s.job.table)}`,

  datasets: `
    SELECT ${q(s.dataset.namespace)} AS namespace, ${q(s.dataset.name)} AS name
    FROM ${q(s.dataset.table)}`,

  reads: `
    SELECT DISTINCT ${q(s.input.namespace)} AS dataset_namespace, ${q(s.input.name)} AS dataset_name,
           ${q(s.input.jobNamespace)} AS job_namespace, ${q(s.input.jobName)} AS job_name
    FROM ${q(s.input.table)}`,

  writes: `
    SELECT DISTINCT ${q(s.output.namespace)} AS dataset_namespace, ${q(s.output.name)} AS dataset_name,
           ${q(s.output.jobNamespace)} AS job_namespace, ${q(s.output.jobName)} AS job_name
    FROM ${q(s.output.table)}`,

  views: `
    SELECT DISTINCT ${q(s.view.viewNamespace)} AS view_namespace, ${q(s.view.viewName)} AS view_name,
           ${q(s.view.baseNamespace)} AS base_namespace, ${q(s.view.baseName)} AS base_name
    FROM ${q(s.view.table)}`,

  fields: `
    SELECT ${q(s.field.namespace)} AS dataset_namespace, ${q(s.field.dataset)} AS dataset_name,
           ${q(s.field.name)} AS name, CAST(${q(s.field.type)} AS VARCHAR) AS type,
           CAST(${q(s.field.description)} AS VARCHAR) AS description
    FROM ${q(s.field.table)}`,

  columnLineage: `
    SELECT DISTINCT ${q(cl.jobNamespace)} AS job_namespace, ${q(cl.jobName)} AS job_name,
           ${q(cl.inputNamespace)} AS input_namespace, ${q(cl.inputDataset)} AS input_dataset,
           ${q(cl.inputField)} AS input_field,
           ${q(cl.outputNamespace)} AS output_namespace, ${q(cl.outputDataset)} AS output_dataset,
           ${q(cl.outputField)} AS output_field,
           ${q(cl.transformationType)} AS transformation_type,
           ${q(cl.transformationSubtype)} AS transformation_subtype
    FROM ${q(cl.table)}`,
};
