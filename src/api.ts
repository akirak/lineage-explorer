import type { ApiError, Graph, JobRun } from '../shared/types.ts';

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as Partial<ApiError>).error || `Request failed (${res.status})`);
  return body as T;
}

export const fetchGraph = () => get<Graph>('/api/graph');

export const fetchJobRuns = (namespace: string, name: string) =>
  get<JobRun[]>(`/api/job-runs?namespace=${encodeURIComponent(namespace)}&name=${encodeURIComponent(name)}`);
