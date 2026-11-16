// Thin wrapper around the backend REST API.
const request = async (path, options = {}) => {
  const response = await fetch(`/api${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok && !body.results) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
};

export const api = {
  health: () => request('/health'),
  listDocuments: () => request('/documents'),
  uploadDocument: (file) => {
    const form = new FormData();
    form.append('files', file);
    return request('/documents', { method: 'POST', body: form });
  },
  deleteDocument: (docId) => request(`/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' }),
  listEvaluationRuns: () => request('/evaluation/runs'),
  getEvaluationRun: (id) => request(`/evaluation/runs/${encodeURIComponent(id)}`),
  ask: (question) =>
    request('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question }) }),
};
