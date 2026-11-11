export type TaskState = 'IDLE' | 'PENDING' | 'STARTED' | 'RETRY' | 'SUCCESS' | 'FAILURE' | string;

export type StartTaskResponse = {
  message?: string;
  task_id: string;
  status?: string;
};

export type TaskStatusResponse = {
  task_id?: string;
  state?: TaskState;
  task_status?: string;
  message?: string;
  result?: unknown;
  error?: string;
};

export type ProposalResult = {
  status?: string;
  task_id?: string;
  final_proposal?: string | null;
  error_message?: string | null;
  error?: string;
};

export const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8800').replace(/\/$/, '');

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`The API returned a non-JSON response (HTTP ${response.status}). Check that FastAPI is running and the URL is correct.`);
  }

  if (!response.ok) {
    const detail = typeof payload === 'object' && payload !== null && 'detail' in payload
      ? String((payload as { detail: unknown }).detail)
      : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return payload as T;
}

export async function startProposalTask(url: string): Promise<StartTaskResponse> {
  const response = await fetch(`${API_BASE_URL}/api/generate_proposal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    cache: 'no-store',
  });
  return readJson<StartTaskResponse>(response);
}

export async function getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/api/task-status/${encodeURIComponent(taskId)}`, {
    method: 'GET',
    cache: 'no-store',
  });
  return readJson<TaskStatusResponse>(response);
}

export function normalizeTaskState(payload: TaskStatusResponse): TaskState {
  return String(payload.task_status || payload.state || 'PENDING').toUpperCase();
}

export function getProposalFromPayload(payload: TaskStatusResponse): ProposalResult | null {
  if (!payload || typeof payload.result !== 'object' || payload.result === null) return null;
  return payload.result as ProposalResult;
}
