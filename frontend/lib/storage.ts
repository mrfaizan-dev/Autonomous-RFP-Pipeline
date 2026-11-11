export type SavedRun = {
  taskId: string;
  url: string;
  state: string;
  createdAt: string;
  proposal?: string;
  error?: string;
};

const STORAGE_KEY = 'bidforge:recent-runs:v1';

export function readRuns(): SavedRun[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? (parsed as SavedRun[]).slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function writeRun(run: SavedRun): SavedRun[] {
  const current = readRuns().filter((item) => item.taskId !== run.taskId);
  const next = [run, ...current].slice(0, 8);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The workspace continues to work if browser storage is unavailable.
  }
  return next;
}
