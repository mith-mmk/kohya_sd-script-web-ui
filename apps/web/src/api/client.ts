import type { TrainJob, TrainJobInput, PreprocessOptions, LoRAProfile, LogEvent, PromptListResponse } from '../types/job.js';

const BASE = '/api';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { headers, ...init });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listJobs: () => req<TrainJob[]>(`${BASE}/jobs`),
  getJob: (id: string) => req<TrainJob>(`${BASE}/jobs/${id}`),
  createJob: (input: TrainJobInput, preprocessOptions?: Partial<PreprocessOptions>) =>
    req<TrainJob>(`${BASE}/jobs`, {
      method: 'POST',
      body: JSON.stringify({ input, preprocessOptions }),
    }),
  startJob: (id: string) => req<{ ok: boolean }>(`${BASE}/jobs/${id}/start`, { method: 'POST' }),
  stopJob: (id: string) => req<{ ok: boolean }>(`${BASE}/jobs/${id}/stop`, { method: 'POST' }),
  deleteJob: (id: string) => req<{ ok: boolean }>(`${BASE}/jobs/${id}`, { method: 'DELETE' }),
  resumeJob: (id: string) => req<{ ok: boolean }>(`${BASE}/jobs/${id}/resume`, { method: 'POST' }),
  listJobPrompts: (id: string) => req<PromptListResponse>(`${BASE}/jobs/${id}/prompts`),
  getJobPromptContent: (id: string, subset: string, relativePath: string) =>
    req<{ content: string; updatedAt: string }>(`${BASE}/jobs/${id}/prompts/content?subset=${encodeURIComponent(subset)}&path=${encodeURIComponent(relativePath)}`),
  saveJobPromptContent: (id: string, subset: string, relativePath: string, content: string) =>
    req<{ ok: boolean; updatedAt: string }>(`${BASE}/jobs/${id}/prompts/content`, {
      method: 'PUT',
      body: JSON.stringify({ subset, path: relativePath, content }),
    }),
  getLogs: (id: string, since?: number) =>
    req<LogEvent[]>(`${BASE}/jobs/${id}/logs${since ? `?since=${since}` : ''}`),
  listProfiles: () => req<LoRAProfile[]>(`${BASE}/profiles`),
};

/** Subscribe to live log stream via WebSocket. Returns unsubscribe fn. */
export function subscribeJobLogs(
  jobId: string,
  onEvent: (e: LogEvent) => void,
): () => void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws/jobs/${jobId}/logs`);
  ws.onmessage = ev => {
    try { onEvent(JSON.parse(ev.data as string) as LogEvent); }
    catch { /* ignore malformed */ }
  };
  return () => ws.close();
}
