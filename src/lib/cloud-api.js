const DEFAULT_REMOTE_API_BASE = 'https://school-internal-analysis.hkakjiweu.workers.dev';

function resolveApiBase() {
  const configured = (import.meta.env?.VITE_API_BASE || '').replace(/\/+$/, '');
  if (configured) return configured;

  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return DEFAULT_REMOTE_API_BASE;
    }
  }

  return '';
}

const API_BASE = resolveApiBase();

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      'content-type': 'application/json;charset=utf-8',
      ...(options.headers || {})
    },
    ...options
  });

  if (response.status === 204) return null;
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || '云端请求失败');
  }
  return payload;
}

export function pingCloud() {
  return request('/api/health');
}

export function fetchCloudProfile() {
  return request('/api/profile');
}

export function saveCloudProfile(profile) {
  return request('/api/profile', {
    method: 'POST',
    body: JSON.stringify(profile)
  });
}

export function listCloudDatasets() {
  return request('/api/datasets');
}

export function fetchCloudDataset(datasetId) {
  return request(`/api/datasets/${encodeURIComponent(datasetId)}`);
}

export function saveCloudDataset(dataset) {
  return request('/api/datasets', {
    method: 'POST',
    body: JSON.stringify(dataset)
  });
}

export function deleteCloudDataset(datasetId) {
  return request(`/api/datasets/${encodeURIComponent(datasetId)}`, {
    method: 'DELETE'
  });
}
