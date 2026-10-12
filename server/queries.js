import { schema as s } from './schema.js';

const q = (id) => `"${String(id).replace(/"/g, '""')}"`;

export const graphQueries = {
  jobs: `
    WITH last_event AS (
      SELECT r.${q(s.run.jobNamespace)} AS ns, r.${q(s.run.jobName)} AS name,
             e.${q(s.runEvent.type)} AS state, e.${q(s.runEvent.time)} AS ts,
             ROW_NUMBER() OVER (
               PARTITION BY r.${q(s.run.jobNamespace)}, r.${q(s.run.jobName)}
               ORDER BY e.${q(s.runEvent.time)} DESC
             ) AS rn
      FROM ${q(s.run.table)} r
      JOIN ${q(s.runEvent.table)} e ON e.${q(s.runEvent.runId)} = r.${q(s.run.id)}
    )
    SELECT j.${q(s.job.namespace)} AS namespace, j.${q(s.job.name)} AS name,
           l.state AS state, CAST(l.ts AS VARCHAR) AS last_event_time
    FROM ${q(s.job.table)} j
    LEFT JOIN last_event l
      ON l.ns = j.${q(s.job.namespace)} AND l.name = j.${q(s.job.name)} AND l.rn = 1`,

  datasets: `
    SELECT ${q(s.dataset.namespace)} AS namespace, ${q(s.dataset.name)} AS name
    FROM ${q(s.dataset.table)}`,

  reads: `
    SELECT DISTINCT i.${q(s.input.namespace)} AS dataset_namespace, i.${q(s.input.name)} AS dataset_name,
           r.${q(s.run.jobNamespace)} AS job_namespace, r.${q(s.run.jobName)} AS job_name
    FROM ${q(s.input.table)} i
    JOIN ${q(s.run.table)} r ON r.${q(s.run.id)} = i.${q(s.input.runId)}`,

  writes: `
    SELECT DISTINCT o.${q(s.output.namespace)} AS dataset_namespace, o.${q(s.output.name)} AS dataset_name,
           r.${q(s.run.jobNamespace)} AS job_namespace, r.${q(s.run.jobName)} AS job_name
    FROM ${q(s.output.table)} o
    JOIN ${q(s.run.table)} r ON r.${q(s.run.id)} = o.${q(s.output.runId)}`,
};

export const jobRunsQuery = `
  SELECT CAST(r.${q(s.run.id)} AS VARCHAR) AS run_id,
         CAST(r.${q(s.run.parentId)} AS VARCHAR) AS parent_run_id,
         arg_max(e.${q(s.runEvent.type)}, e.${q(s.runEvent.time)}) AS state,
         CAST(min(e.${q(s.runEvent.time)}) AS VARCHAR) AS started_at,
         CAST(max(e.${q(s.runEvent.time)}) AS VARCHAR) AS last_event_at,
         date_diff('millisecond', min(e.${q(s.runEvent.time)}), max(e.${q(s.runEvent.time)})) AS duration_ms
  FROM ${q(s.run.table)} r
  LEFT JOIN ${q(s.runEvent.table)} e ON e.${q(s.runEvent.runId)} = r.${q(s.run.id)}
  WHERE r.${q(s.run.jobNamespace)} = ? AND r.${q(s.run.jobName)} = ?
  GROUP BY r.${q(s.run.id)}, r.${q(s.run.parentId)}
  ORDER BY min(e.${q(s.runEvent.time)}) DESC NULLS LAST
  LIMIT 50`;
