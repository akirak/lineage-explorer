async function get(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

export const fetchGraph = () => get('/api/graph');

export const fetchJobRuns = (namespace, name) =>
  get(`/api/job-runs?namespace=${encodeURIComponent(namespace)}&name=${encodeURIComponent(name)}`);
