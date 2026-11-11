"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  CircleDot,
  Clock3,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  Globe2,
  History,
  LoaderCircle,
  Network,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Backend endpoint is configured once here (or via NEXT_PUBLIC_API_BASE_URL).
// It is no longer shown or editable anywhere in the UI.
const API_BASE = normalizeBase(process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8800");
const HISTORY_STORAGE_KEY = "aegisiq_recent_runs_v1";
// Admin secrets are entered per session and are never bundled or persisted.
const MAX_HISTORY = 10;

const POLL_INTERVAL_MS = 1800;

type RunState =
  | "idle"
  | "submitting"
  | "queued"
  | "running"
  | "waiting_review"
  | "resuming"
  | "completed"
  | "failed"
  | "cancelled";

type ApiIndicatorKind = "idle" | "ok" | "bad" | "busy";

type ProposalRun = {
  taskId: string | null;
  // Latest Celery task (changes after approve/revise); taskId remains the run identity.
  pollTaskId?: string;
  threadId: string | null;
  url: string;
  state: RunState;
  createdAt: number;
  updatedAt: number;
  message?: string;
  draftProposal?: string;
  finalProposal?: string;
  criticStatus?: string;
  critiqueFeedback?: string;
  ragWarning?: string;
  error?: string;
  lastNativeState?: string;
  lastPollError?: string;
  draftUpdatedFromServer?: boolean;
};

type ApiPayload = Record<string, any>;
type ToastItem = { id: number; message: string; error: boolean };
type RunInfo = {
  label: string;
  badgeClass: string;
  title: string;
  message: string;
  progress: number;
  caption: string;
  statusText: string;
};

function normalizeBase(value: string) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function safeUrl(value: string): string | null {
  try {
    const parsed = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function hostFromUrl(value?: string) {
  try {
    return value ? new URL(value).hostname : "New proposal task";
  } catch {
    return value || "New proposal task";
  }
}

function formatDate(timestamp?: number, includeTime = true) {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(
    undefined,
    includeTime
      ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
      : { month: "short", day: "numeric", year: "numeric" },
  ).format(date);
}

function elapsed(run?: ProposalRun | null) {
  if (!run?.createdAt) return "—";
  const endTime = ["completed", "failed", "cancelled"].includes(run.state)
    ? run.updatedAt
    : Date.now();
  const seconds = Math.max(0, Math.floor((endTime - run.createdAt) / 1000));
  if (seconds < 60) return `${seconds}s elapsed`;
  return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s elapsed`;
}

function runStateInfo(run?: ProposalRun | null): RunInfo {
  const state = run?.state || "idle";
  const info: Record<RunState, RunInfo> = {
    idle: {
      label: "IDLE",
      badgeClass: "border-slate-700 bg-slate-800/70 text-slate-300",
      title: "Waiting for a task",
      message: "Submit an RFP URL to begin.",
      progress: 0,
      caption: "No active task",
      statusText: "Not started",
    },
    submitting: {
      label: "SUBMITTING",
      badgeClass: "border-sky-400/20 bg-sky-400/10 text-sky-200",
      title: "Submitting task",
      message: "FastAPI is creating a Celery task.",
      progress: 9,
      caption: "Submitting to FastAPI",
      statusText: "Submitting",
    },
    queued: {
      label: "QUEUED",
      badgeClass: "border-sky-400/20 bg-sky-400/10 text-sky-200",
      title: "Waiting for a worker",
      message:
        run?.message ||
        "Celery has not reported that a worker started this task yet.",
      progress: 13,
      caption: "Queued in Celery",
      statusText: "Queued",
    },
    running: {
      label: "RUNNING",
      badgeClass: "border-amber-300/25 bg-amber-300/10 text-amber-100",
      title: "Pipeline is running",
      message:
        run?.message ||
        "The worker is scraping, retrieving context, analyzing, drafting, and auditing.",
      progress: 57,
      caption: "Worker processing",
      statusText: "Running",
    },
    waiting_review: {
      label: "NEEDS REVIEW",
      badgeClass: "border-amber-300/30 bg-amber-300/10 text-amber-100",
      title: "Human review required",
      message:
        run?.message ||
        "The task returned a draft and paused at the human-review checkpoint.",
      progress: 88,
      caption: "Paused at HITL checkpoint",
      statusText: "Waiting for your decision",
    },
    resuming: {
      label: "RESUMING",
      badgeClass: "border-lime-300/25 bg-lime-300/10 text-lime-100",
      title: "Resuming workflow",
      message: run?.message || "The graph is continuing from its saved checkpoint.",
      progress: 94,
      caption: "Resuming LangGraph",
      statusText: "Resuming",
    },
    completed: {
      label: "APPROVED",
      badgeClass: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
      title: "Proposal finalized",
      message: run?.message || "The final proposal is available below.",
      progress: 100,
      caption: "Proposal finalized",
      statusText: "Approved",
    },
    failed: {
      label: "FAILED",
      badgeClass: "border-red-300/25 bg-red-300/10 text-red-100",
      title: "Task failed",
      message: run?.error || run?.message || "The task failed. Check the error details.",
      progress: 100,
      caption: "Task failed",
      statusText: "Failed",
    },
    cancelled: {
      label: "CANCELLED",
      badgeClass: "border-slate-600 bg-slate-800/70 text-slate-300",
      title: "Task cancelled",
      message: run?.message || "The task was revoked.",
      progress: 100,
      caption: "Task revoked",
      statusText: "Cancelled",
    },
  };
  return info[state] || info.idle;
}

function historyStateLabel(state?: RunState) {
  const labels: Partial<Record<RunState, string>> = {
    submitting: "Submitting",
    queued: "Queued",
    running: "Running",
    waiting_review: "Needs review",
    resuming: "Resuming",
    completed: "Approved",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return labels[state || "idle"] || "Unknown";
}

function historyStateClass(state?: RunState) {
  if (state === "completed") return "text-emerald-200 bg-emerald-300/10 border-emerald-300/20";
  if (state === "waiting_review") return "text-amber-100 bg-amber-300/10 border-amber-300/20";
  if (state === "failed") return "text-red-200 bg-red-300/10 border-red-300/20";
  if (state === "running" || state === "queued" || state === "submitting" || state === "resuming")
    return "text-amber-100 bg-amber-300/10 border-amber-300/20";
  return "text-slate-300 bg-slate-800 border-slate-700";
}

function ErrorMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="err" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function Kicker({ children }: { children: React.ReactNode }) {
  return <div className="eyebrow">{children}</div>;
}

function CountUp({ to, pad = 2 }: { to: number; pad?: number }) {
  // These figures are informational, so render them directly without a JS animation loop.
  return <span>{String(to).padStart(pad, "0")}</span>;
}

const rise = (delay = 0) => ({
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.15 },
  transition: { duration: 0.6, delay, ease: [0.2, 0.7, 0.2, 1] as [number, number, number, number] },
});

const HERO_STEPS = [
  { title: "Extract the RFP", detail: "Playwright · Nodriver · BS4", tag: "Ingest", icon: Globe2 },
  { title: "Ground in portfolio", detail: "Embeddings · ChromaDB", tag: "Retrieve", icon: Database },
  { title: "Draft & critique", detail: "LangGraph · Analyst · Writer · Critic", tag: "Evaluate", icon: Network },
  { title: "Human approval", detail: "Edit, revise or release", tag: "Gate", icon: ShieldCheck },
];

const TECH = ["Python", "LangGraph", "LangChain", "ChromaDB", "Playwright", "Nodriver", "FastAPI", "Celery", "Redis", "Next.js", "TypeScript", "Framer Motion", "GSAP"];

const FLOW = [
  { label: "Extract", detail: "Scraper", icon: FileText },
  { label: "Retrieve", detail: "RAG", icon: Database },
  { label: "Evaluate", detail: "Critic", icon: Network },
  { label: "Approve", detail: "Human", icon: CheckCircle2 },
];

const FEATURES = [
  { n: "01", icon: Network, title: "Analyst → Writer → Critic", text: "Extracts requirements, drafts, then flags unsupported claims." },
  { n: "02", icon: ShieldCheck, title: "Edit, revise, approve", text: "Reviewers resume the saved checkpoint to release the output." },
  { n: "03", icon: Globe2, title: "Three-stage extraction", text: "Browser context, interaction fallback and Nodriver, parsed with BS4." },
  { n: "04", icon: Database, title: "Admin-managed RAG", text: "Protected uploads for PDF, Markdown, text and CSV." },
];

const STACK = [
  { label: "Agents", value: "Python · LangGraph · LangChain · LlamaIndex Core" },
  { label: "Models & search", value: "OpenRouter · Groq · Nemotron Super-VL · Gemini Embeddings · ChromaDB" },
  { label: "Async backend", value: "FastAPI · Celery · Redis · asyncio · checkpoint resume" },
  { label: "Browser automation", value: "Playwright CDP · Nodriver · BeautifulSoup4" },
  { label: "Frontend", value: "Next.js App Router · TypeScript · Tailwind · Framer Motion · ReactMarkdown" },
];

const CAPS = [
  { icon: FileText, title: "URL validation", text: "Checks source links before submitting." },
  { icon: Activity, title: "Live task tracking", text: "Queue state, errors, IDs and elapsed time." },
  { icon: History, title: "Recoverable workspace", text: "Keeps the latest 10 runs in the browser." },
  { icon: CheckCircle2, title: "Auditable output", text: "Feedback, approval, Markdown preview, copy and export." },
];


export default function Page() {
  const activeRunRef = useRef<ProposalRun | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const toastIdRef = useRef(0);
  const editorSourceRef = useRef("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const apiBase = API_BASE;
  const [apiIndicator, setApiIndicator] = useState<{ kind: ApiIndicatorKind; label: string }>({
    kind: "idle",
    label: "API not checked",
  });
  const [apiCheckBusy, setApiCheckBusy] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [activeRun, setActiveRun] = useState<ProposalRun | null>(null);
  const [history, setHistory] = useState<ProposalRun[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resumeBusy, setResumeBusy] = useState<{ title: string; message: string } | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [formAlert, setFormAlert] = useState("");
  const [proposalAlert, setProposalAlert] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminToken, setAdminToken] = useState("");
  const [ragFile, setRagFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminAlert, setAdminAlert] = useState("");
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [refreshBusy, setRefreshBusy] = useState(false);

  // Keep the polling loop pointed at the newest active task without restarting
  // the timer whenever a message/status field changes.
  activeRunRef.current = activeRun;

  const pushToast = useCallback((message: string, error = false) => {
    const id = ++toastIdRef.current;
    setToasts((current) => [...current, { id, message, error }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4500);
  }, []);

  const persistHistory = useCallback((nextHistory: ProposalRun[]) => {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(nextHistory.slice(0, MAX_HISTORY)));
    } catch (error) {
      console.warn("Could not persist run history:", error);
      pushToast("Browser storage is full; the current run is still available until this page is closed.", true);
    }
  }, [pushToast]);

  const upsertHistory = useCallback((run: ProposalRun) => {
    if (!run || !run.taskId) return;
    setHistory((current) => {
      const updated: ProposalRun = { ...run, updatedAt: Date.now() };
      return [updated, ...current.filter((item) => item.taskId !== run.taskId)].slice(0, MAX_HISTORY);
    });
  }, []);

  const updateActive = useCallback((patch: Partial<ProposalRun>, options: { save?: boolean } = {}) => {
    const current = activeRunRef.current;
    if (!current) return;

    // Identical status responses are common while Celery is processing. Do not
    // trigger a full-page React render just to update an invisible timestamp.
    const hasVisibleChange = Object.keys(patch).some((key) =>
      !Object.is(
        current[key as keyof ProposalRun],
        patch[key as keyof ProposalRun],
      ),
    );
    if (!hasVisibleChange) return;

    const next: ProposalRun = { ...current, ...patch, updatedAt: Date.now() };
    activeRunRef.current = next;
    setActiveRun(next);

    // Avoid serializing/writing the full history on every unchanged Celery poll.
    const meaningfulChange =
      next.state !== current.state ||
      next.pollTaskId !== current.pollTaskId ||
      next.threadId !== current.threadId ||
      next.draftProposal !== current.draftProposal ||
      next.finalProposal !== current.finalProposal ||
      next.criticStatus !== current.criticStatus ||
      next.critiqueFeedback !== current.critiqueFeedback ||
      next.ragWarning !== current.ragWarning ||
      next.error !== current.error ||
      next.lastPollError !== current.lastPollError;

    if (options.save !== false && meaningfulChange) upsertHistory(next);
  }, [upsertHistory]);

  const apiFetch = useCallback(async (path: string, options: RequestInit & { timeout?: number } = {}) => {
    const { timeout = 30000, ...fetchOptions } = options;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeout);
    try {
      const headers = new Headers(fetchOptions.headers);

      headers.set("Accept", "application/json");

      // Bypass ngrok free-tier browser interstitial for API requests.
      headers.set("ngrok-skip-browser-warning", "1");

      if (fetchOptions.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json"); }
      const response = await fetch(`${apiBase}${path}`, {
        ...fetchOptions,
        headers,
        signal: controller.signal,
      });
      const raw = await response.text();
      let payload: ApiPayload = {};
      if (raw) {
        try {
          payload = JSON.parse(raw) as ApiPayload;
        } catch {
          payload = { detail: raw.slice(0, 1500) };
        }
      }
      if (!response.ok) {
        const detail = payload.detail || payload.error || payload.message || `HTTP ${response.status} ${response.statusText}`;
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }
      return payload;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Request timed out. Check that FastAPI is running and reachable.");
      }
      if (error instanceof TypeError) {
        throw new Error("Could not reach the backend service. Check that it is running and that CORS is configured.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, [apiBase]);

  const showFormError = useCallback((message: string) => setFormAlert(message), []);
  const showProposalError = useCallback((message: string) => setProposalAlert(message), []);

  // Hydrate saved browser settings and recent runs once, after client mount.
  useEffect(() => {
    try {
      const rawHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
      const parsed: unknown = rawHistory ? JSON.parse(rawHistory) : [];
      const savedHistory = Array.isArray(parsed)
        ? (parsed as ProposalRun[]).filter((item) => item && typeof item === "object" && item.taskId).slice(0, MAX_HISTORY)
        : [];
      setHistory(savedHistory);
      if (savedHistory.length) {
        const latest = savedHistory[0];
        setActiveRun(latest);
        activeRunRef.current = latest;
        setUrlInput(latest.url || "");
      }
      // Admin token is intentionally not restored from browser storage.
    } catch (error) {
      console.warn("Could not restore local workspace:", error);
    } finally {
      setHydrated(true);
    }
  }, []);

  // Persist local-only history whenever it changes. Backend tasks/checkpoints
  // are not deleted when this browser list is cleared.
  useEffect(() => {
    if (hydrated) persistHistory(history);
  }, [history, hydrated, persistHistory]);

  const setActiveRunSafe = useCallback((run: ProposalRun | null) => {
    activeRunRef.current = run;
    setActiveRun(run);
  }, []);

  const checkApi = useCallback(async () => {
    setApiIndicator({ kind: "busy", label: "Checking API…" });
    setApiCheckBusy(true);
    try {
      await apiFetch("/openapi.json", { method: "GET", timeout: 10000 });
      setApiIndicator({ kind: "ok", label: "FastAPI reachable" });
      pushToast("FastAPI is reachable. This confirms the API docs endpoint, not Redis or the Celery worker.");
    } catch (error) {
      setApiIndicator({ kind: "bad", label: "API unavailable" });
      pushToast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setApiCheckBusy(false);
    }
  }, [apiFetch, pushToast]);

  const applyTaskStatus = useCallback((payload: ApiPayload, taskId: string) => {
    const current = activeRunRef.current;
    const currentTaskId = current?.pollTaskId || current?.taskId;
    if (!current || currentTaskId !== taskId) return;
    const result: ApiPayload = payload && typeof payload.result === "object" && payload.result !== null ? payload.result : {};
    const nativeState = String(payload.state || payload.task_status || "PENDING").toUpperCase();
    const resultStatus = String(result.status || "").toUpperCase();
    const needsReview = Boolean(
      payload.needs_human_review ||
      result.needs_human_review ||
      payload.task_status === "PAUSED_FOR_HUMAN_REVIEW" ||
      resultStatus === "PAUSED_FOR_HUMAN_REVIEW",
    );
    const common: Partial<ProposalRun> = {
      threadId: payload.thread_id || result.thread_id || current.threadId,
      criticStatus: result.critique_status || current.criticStatus || "",
      critiqueFeedback: result.critique_feedback || current.critiqueFeedback || "",
      ragWarning: result.rag_warning ?? current.ragWarning ?? "",
      lastNativeState: nativeState,
      lastPollError: "",
      message: payload.message || result.message || current.message || "",
      error: "",
    };

    if (needsReview) {
      const draft = typeof result.draft_proposal === "string" ? result.draft_proposal : current.draftProposal || "";
      updateActive({ ...common, state: "waiting_review", draftProposal: draft, finalProposal: "", message: "The Celery task has paused for your approval." });
      setApiIndicator({ kind: "ok", label: "Human review required" });
      pushToast("Draft ready for review. Edit it, request changes, or approve it.");
      return;
    }

    if (nativeState === "FAILURE") {
      const error = String(payload.error || result.error_message || "The Celery worker reported a task failure. Check the backend and worker logs.");
      updateActive({ ...common, state: "failed", error, message: error, draftProposal: result.draft_proposal || current.draftProposal || "" });
      setApiIndicator({ kind: "bad", label: "Celery task failed" });
      pushToast("Celery task failed. See the monitor for the error.", true);
      return;
    }

    if (nativeState === "REVOKED") {
      updateActive({ ...common, state: "cancelled", message: "The Celery task was revoked." });
      setApiIndicator({ kind: "idle", label: "Task cancelled" });
      return;
    }

    const finalProposal = typeof result.final_proposal === "string" ? result.final_proposal : "";
    if (nativeState === "SUCCESS" || resultStatus === "SUCCESS") {
      if (finalProposal.trim()) {
        updateActive({ ...common, state: "completed", finalProposal, draftProposal: result.draft_proposal || finalProposal, message: "The backend returned a finalized proposal." });
        setApiIndicator({ kind: "ok", label: "Task completed" });
        pushToast("Final proposal received.");
      } else {
        updateActive({
          ...common,
          state: "failed",
          error: "Celery returned SUCCESS without a final proposal or a human-review checkpoint. Inspect the task result and backend logs.",
          message: "Unexpected backend response: no final proposal or review checkpoint.",
        });
        setApiIndicator({ kind: "bad", label: "Unexpected task result" });
      }
      return;
    }

    if (nativeState === "PENDING" && current.state === "resuming") {
      updateActive({
        ...common,
        state: "resuming",
        message: "Resume task is queued and waiting for a Celery worker.",
      });
      setApiIndicator({ kind: "busy", label: "Waiting for resume worker" });
      return;
    }

    if (["STARTED", "RETRY", "RECEIVED"].includes(nativeState)) {
      updateActive({
        ...common,
        state: current.state === "resuming" ? "resuming" : "running",
        message: payload.message || (nativeState === "RETRY"
          ? "Celery is retrying the task."
          : "The worker is processing the request."),
      });
      setApiIndicator({
        kind: "busy",
        label: current.state === "resuming" ? "Resume task running" : "Celery task running",
      });
      return;
    }

    updateActive({
      ...common,
      state: current.state === "resuming" ? "resuming" : "queued",
      message: payload.message || "Task is queued and waiting for a worker.",
    });
    setApiIndicator({ kind: "busy", label: "Waiting for Celery" });
  }, [pushToast, updateActive]);

  // Poll the latest Celery task. The original taskId remains the stable
  // browser-history identity while pollTaskId changes after approve/revise.
  useEffect(() => {
    const run = activeRun;
    const taskId = run?.pollTaskId || run?.taskId;

    if (!run || !taskId || !["queued", "running", "resuming"].includes(run.state)) {
      return;
    }

    let cancelled = false;

    const schedule = (delay: number) => {
      pollTimerRef.current = window.setTimeout(async () => {
        pollTimerRef.current = null;
        if (cancelled) return;

        const current = activeRunRef.current;
        const currentTaskId = current?.pollTaskId || current?.taskId;

        if (
          !current ||
          currentTaskId !== taskId ||
          !["queued", "running", "resuming"].includes(current.state)
        ) {
          return;
        }

        try {
          const payload = await apiFetch(
            `/api/task-status/${encodeURIComponent(taskId)}`,
            { method: "GET", timeout: 15000 }
          );

          if (!cancelled) applyTaskStatus(payload, taskId);
        } catch (error) {
          const latest = activeRunRef.current;
          const latestTaskId = latest?.pollTaskId || latest?.taskId;

          if (
            !cancelled &&
            latest &&
            latestTaskId === taskId &&
            ["queued", "running", "resuming"].includes(latest.state)
          ) {
            const message = error instanceof Error ? error.message : String(error);
            updateActive({
              lastPollError: message,
              message: `Status check failed: ${message}`,
            });
            setApiIndicator({ kind: "bad", label: "Status check failed" });
          }
        }

        const latest = activeRunRef.current;
        const latestTaskId = latest?.pollTaskId || latest?.taskId;

        if (
          !cancelled &&
          latest &&
          latestTaskId === taskId &&
          ["queued", "running", "resuming"].includes(latest.state)
        ) {
          schedule(POLL_INTERVAL_MS);
        }
      }, delay);
    };

    schedule(run.state === "queued" ? 600 : POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollTimerRef.current !== null) {
        window.clearTimeout(pollTimerRef.current);
      }
      pollTimerRef.current = null;
    };
  }, [
    activeRun?.taskId,
    activeRun?.pollTaskId,
    activeRun?.state,
    apiFetch,
    applyTaskStatus,
    updateActive,
  ]);

  // Load the selected review draft into the editor only when its backend draft
  // actually changes; routine monitor updates must not overwrite local edits.
  useEffect(() => {
    if (activeRun?.state !== "waiting_review") return;
    const sourceKey = `${activeRun.taskId || "no-task"}::${activeRun.draftProposal || ""}`;
    if (editorSourceRef.current !== sourceKey) {
      editorSourceRef.current = sourceKey;
      setEditorValue(activeRun.draftProposal || "");
    }
  }, [activeRun?.taskId, activeRun?.state, activeRun?.draftProposal]);

  const handleGenerate = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setFormAlert("");
    setProposalAlert("");
    const targetUrl = safeUrl(urlInput.trim());
    if (!targetUrl) {
      showFormError("Enter a valid URL beginning with http:// or https://.");
      return;
    }

    setIsSubmitting(true);
    const now = Date.now();
    const temporary: ProposalRun = {
      taskId: null,
      threadId: null,
      url: targetUrl,
      state: "submitting",
      createdAt: now,
      updatedAt: now,
      message: "Submitting the task to FastAPI…",
    };
    setActiveRunSafe(temporary);
    setEditorValue("");
    editorSourceRef.current = "";

    try {
      const payload = await apiFetch("/api/generate_proposal", {
        method: "POST",
        body: JSON.stringify({ url: targetUrl }),
        timeout: 30000,
      });
      if (!payload.task_id) throw new Error("FastAPI accepted the request but did not return task_id. Check the backend response.");
      const run: ProposalRun = {
        taskId: String(payload.task_id),
        pollTaskId: String(payload.task_id),
        threadId: String(payload.thread_id || `proposal_thread_${payload.task_id}`),
        url: targetUrl,
        state: "queued",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        message: payload.message || "Proposal generation pipeline started.",
        draftProposal: "",
        finalProposal: "",
        criticStatus: "",
        critiqueFeedback: "",
        ragWarning: "",
        error: "",
      };
      setActiveRunSafe(run);
      upsertHistory(run);
      setApiIndicator({ kind: "ok", label: "FastAPI reachable" });
      pushToast("Task queued. The monitor is now checking Celery status.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed: ProposalRun = { ...temporary, state: "failed", error: message, message, taskId: null };
      setActiveRunSafe(failed);
      setApiIndicator({ kind: "bad", label: "Request failed" });
      showFormError(message);
      pushToast(message, true);
    } finally {
      setIsSubmitting(false);
    }
  }, [apiFetch, isSubmitting, pushToast, setActiveRunSafe, showFormError, upsertHistory, urlInput]);

  const manualRefresh = useCallback(async () => {
    const run = activeRunRef.current;
    const taskId = run?.pollTaskId || run?.taskId;

    if (!run || !taskId) {
      pushToast("There is no task ID to refresh.", true);
      return;
    }

    if (!["queued", "running", "resuming"].includes(run.state)) {
      pushToast(
        run.state === "waiting_review"
          ? "This task is paused at the human-review checkpoint."
          : "This run is not actively polling. Select a queued or running run to refresh."
      );
      return;
    }

    setRefreshBusy(true);

    try {
      const payload = await apiFetch(
        `/api/task-status/${encodeURIComponent(taskId)}`,
        { method: "GET", timeout: 15000 }
      );
      applyTaskStatus(payload, taskId);
      pushToast("Task status refreshed.");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setRefreshBusy(false);
    }
  }, [apiFetch, applyTaskStatus, pushToast]);

  const resumeWorkflow = useCallback(async (action: "APPROVE" | "REVISE") => {
    const run = activeRunRef.current;

    if (!run?.threadId) {
      showProposalError(
        "No thread_id is available. Start a new proposal run and wait for the human-review checkpoint."
      );
      return;
    }

    if (run.state !== "waiting_review") {
      showProposalError(
        "The backend is not currently waiting at a human-review checkpoint."
      );
      return;
    }

    if (resumeBusy) return;

    setProposalAlert("");

    const feedback = reviewFeedback.trim();
    const editedProposal = editorValue.trim();

    if (action === "REVISE" && !feedback) {
      showProposalError(
        "Revision feedback is required. Tell the writer exactly what to change."
      );
      return;
    }

    if (action === "APPROVE" && !editedProposal) {
      showProposalError("The proposal is empty. Add the proposal text before approving.");
      return;
    }

    setResumeBusy({
      title: action === "APPROVE"
        ? "Finalizing approved proposal…"
        : "Sending revision request…",
      message: action === "APPROVE"
        ? "Approval submitted. Waiting for Celery to finalize the proposal."
        : "Revision submitted. Waiting for the Writer and Critic to finish.",
    });

    try {
      const body = action === "APPROVE"
        ? {
            action: "APPROVE",
            feedback: feedback || null,
            edited_proposal: editedProposal,
          }
        : {
            action: "REVISE",
            feedback,
            edited_proposal: null,
          };

      const payload = await apiFetch(
        `/api/resume-proposal/${encodeURIComponent(run.threadId)}`,
        {
          method: "POST",
          body: JSON.stringify(body),
          timeout: 30000,
        }
      );

      // The backend returns immediately with a NEW Celery task ID.
      // Poll that task until it returns Success or another review checkpoint.
      const resumeTaskId = String(payload.task_id || "").trim();

      if (!resumeTaskId) {
        throw new Error(
          "Backend accepted the resume request but did not return a new task_id."
        );
      }

      updateActive({
        pollTaskId: resumeTaskId,
        threadId: payload.thread_id || run.threadId,
        state: "resuming",
        finalProposal: "",
        criticStatus: action === "REVISE" ? "PENDING" : run.criticStatus,
        critiqueFeedback: "",
        error: "",
        lastNativeState: "PENDING",
        lastPollError: "",
        message: action === "APPROVE"
          ? "Approval submitted. Waiting for backend finalization."
          : "Revision submitted. Writer and Critic are processing the changes.",
      });

      setReviewFeedback("");
      setProposalAlert("");

      pushToast(
        action === "APPROVE"
          ? "Approval submitted. Monitoring finalization."
          : "Revision submitted. Monitoring the new draft."
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showProposalError(message);
      pushToast(message, true);
    } finally {
      setResumeBusy(null);
    }
  }, [
    apiFetch,
    editorValue,
    pushToast,
    resumeBusy,
    reviewFeedback,
    showProposalError,
    updateActive,
  ]);

  const copyText = useCallback(async (text: string, successMessage: string) => {
    if (!text) {
      pushToast("There is no text to copy yet.", true);
      return;
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const temp = document.createElement("textarea");
        temp.value = text;
        temp.style.position = "fixed";
        temp.style.opacity = "0";
        document.body.appendChild(temp);
        temp.select();
        const ok = document.execCommand("copy");
        temp.remove();
        if (!ok) throw new Error("Copy command was blocked by the browser.");
      }
      pushToast(successMessage);
    } catch (error) {
      pushToast(`Could not copy text: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  }, [pushToast]);

  const getProposalText = useCallback(() => {
    const run = activeRunRef.current;
    if (run?.state === "completed") return run.finalProposal || "";
    if (run?.state === "waiting_review") return editorValue.trim();
    return run?.draftProposal || run?.finalProposal || "";
  }, [editorValue]);

  const downloadProposal = useCallback(() => {
    const text = getProposalText();
    if (!text) {
      pushToast("There is no proposal to download yet.", true);
      return;
    }
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `aegisiq-proposal-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    pushToast("Markdown download started.");
  }, [getProposalText, pushToast]);

  const selectHistoryRun = useCallback((taskId: string | null) => {
    const selected = history.find((item) => item.taskId === taskId);
    if (!selected) return;
    const run: ProposalRun = {
      ...selected,
      state: selected.state === "submitting" ? "queued" : selected.state,
    };
    setActiveRunSafe(run);
    setUrlInput(run.url || "");
    setReviewFeedback("");
    setProposalAlert("");
    setFormAlert("");
    editorSourceRef.current = "";
    setEditorValue(run.draftProposal || "");
    if (run.state === "waiting_review") {
      pushToast("Review checkpoint loaded. Edits are local until you submit an approval or revision.");
    } else {
      pushToast("Run loaded from local browser history.");
    }
    document.getElementById("proposal-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [history, pushToast, setActiveRunSafe]);

  const removeHistoryRun = useCallback((taskId: string | null) => {
    const next = history.filter((item) => item.taskId !== taskId);
    setHistory(next);
    persistHistory(next);
    if (activeRunRef.current?.taskId === taskId) {
      const latest = next[0] || null;
      setActiveRunSafe(latest);
      if (latest) setUrlInput(latest.url || "");
    }
    pushToast("Run removed from this browser’s history. The backend task was not deleted.");
  }, [activeRun, history, persistHistory, pushToast, setActiveRunSafe]);

  const clearHistory = useCallback(() => {
    if (!history.length) return;
    const confirmed = window.confirm("Clear all locally saved run history? This does not cancel Celery tasks or delete LangGraph checkpoints.");
    if (!confirmed) return;
    setHistory([]);
    persistHistory([]);
    setActiveRunSafe(null);
    pushToast("Local history cleared.");
  }, [history.length, persistHistory, pushToast, setActiveRunSafe]);

  const openAdmin = useCallback(() => {
    setAdminOpen(true);
    setAdminAlert("");
  }, []);

  const closeAdmin = useCallback(() => {
    setAdminOpen(false);
    setRagFile(null);
    setDragOver(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setAdminAlert("");
  }, []);

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setRagFile(event.target.files?.[0] || null);
  }, []);

  const handleFileDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) setRagFile(file);
  }, []);

  const submitRagUpload = useCallback(async () => {
    const token = adminToken.trim();

    if (!token) {
      setAdminAlert("Admin token is required.");
      return;
    }

    if (!ragFile) {
      setAdminAlert("Please select a file to upload.");
      return;
    }

    setAdminAlert("");
    setAdminBusy(true);

    const originalName = ragFile.name;
    const formData = new FormData();
    formData.append("file", ragFile);

    try {
      // Upload the file and receive the background Celery indexing task ID.
      const response = await fetch(`${apiBase}/api/admin/upload-rag-file`, {
        method: "POST",
        headers: {
          "X-Admin-Token": token,
          "ngrok-skip-browser-warning": "1",
        },
        body: formData,
      });

      let uploadPayload: ApiPayload = {};
      try {
        uploadPayload = await response.json();
      } catch {
        throw new Error("Backend returned an invalid upload response.");
      }

      if (!response.ok) {
        const detail = uploadPayload.detail || uploadPayload.message || "RAG upload failed.";
        throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
      }

      const taskId = String(uploadPayload.task_id || "").trim();
      if (!taskId) {
        throw new Error(
          "File was received, but the backend did not return an indexing task ID."
        );
      }

      pushToast("File uploaded. Waiting for RAG indexing to finish.");

      // The upload endpoint returns Processing. Verify the actual Celery result.
      const maxAttempts = 180;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        await new Promise<void>((resolve) => {
          window.setTimeout(resolve, 2000);
        });

        let taskStatus: ApiPayload;

        try {
          taskStatus = await apiFetch(
            `/api/task-status/${encodeURIComponent(taskId)}`,
            { method: "GET", timeout: 15000 }
          );
        } catch (pollError) {
          if (attempt === maxAttempts - 1) throw pollError;
          continue;
        }

        const nativeState = String(
          taskStatus.state || taskStatus.task_status || "PENDING"
        ).toUpperCase();

        if (nativeState === "FAILURE") {
          throw new Error(
            String(taskStatus.error || "RAG document indexing failed. Check the Celery worker logs.")
          );
        }

        if (nativeState === "REVOKED") {
          throw new Error("RAG indexing task was cancelled.");
        }

        if (nativeState === "SUCCESS") {
          const result =
            taskStatus.result && typeof taskStatus.result === "object"
              ? taskStatus.result as ApiPayload
              : {};

          if (String(result.status || "").toLowerCase() !== "success") {
            const detail = result.detail || result.message ||
              "Celery completed, but RAG indexing did not report success.";
            throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
          }

          pushToast(
            result.message || `${originalName} successfully indexed in the RAG knowledge base.`
          );
          closeAdmin();
          return;
        }
      }

      throw new Error(
        `RAG indexing is taking longer than expected. Task ID: ${taskId}. Check the existing task before uploading again.`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAdminAlert(message);
      pushToast(message, true);
    } finally {
      setAdminBusy(false);
    }
  }, [adminToken, apiBase, apiFetch, closeAdmin, pushToast, ragFile]);

  // Keep the existing keyboard shortcut and Ctrl/Cmd+Enter revision shortcut.
  useEffect(() => {
    const onGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "a") {
        event.preventDefault();
        openAdmin();
      }
    };
    window.addEventListener("keydown", onGlobalKeyDown);
    return () => window.removeEventListener("keydown", onGlobalKeyDown);
  }, [openAdmin]);

  const onFeedbackKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void resumeWorkflow("REVISE");
    }
  };

  const runInfo = useMemo(() => runStateInfo(activeRun), [activeRun]);
  const hasMonitor = Boolean(activeRun && (activeRun.taskId || activeRun.state === "submitting" || (activeRun.state === "failed" && activeRun.error)));
  const finalText = typeof activeRun?.finalProposal === "string" ? activeRun.finalProposal : "";
  const draftText = typeof activeRun?.draftProposal === "string" ? activeRun.draftProposal : "";
  const hasFinal = activeRun?.state === "completed" && Boolean(finalText.trim());
  const hasReviewDraft = activeRun?.state === "waiting_review" && Boolean(draftText.trim());
  const hasDraft = Boolean(draftText.trim() || finalText.trim());
  const words = editorValue.trim() ? editorValue.trim().split(/\s+/).length : 0;
  const editorEdited = editorValue.trim() !== (activeRun?.draftProposal || "").trim();



  const isLive = Boolean(activeRun && ["submitting", "queued", "running", "resuming"].includes(activeRun.state));
  const reviewLabel =
    activeRun?.state === "waiting_review" ? "Waiting on you"
    : activeRun?.state === "completed" ? "Approved"
    : ["failed", "cancelled"].includes(activeRun?.state || "") ? "Stopped"
    : "Not reached";

  return (
    <div className="aq relative min-h-screen overflow-x-hidden">
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500;600&family=Instrument+Serif:ital@0;1&display=swap"
      />

      <style jsx global>{`
        html { background: #0a0b0e; scroll-behavior: smooth; }
        body { margin: 0; background: #0a0b0e; }

        .aq {
          --bg: #0a0b0e;
          --ink: #f5f2ea;
          --ink2: #c9c5bb;
          --ink3: #96928a;
          --line: rgba(255, 255, 255, .105);
          --line2: rgba(255, 255, 255, .2);
          --ember: #ff8a4c;
          --ember2: #ffb68f;
          --ok: #7be0a4;
          --warn: #ffd27a;
          --bad: #ff8d8d;
          --serif: "Instrument Serif", "Iowan Old Style", Georgia, serif;
          --mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-family: Geist, Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
          background: var(--bg);
          color: var(--ink);
          color-scheme: dark;
          -webkit-font-smoothing: antialiased;
          text-rendering: optimizeLegibility;
          font-feature-settings: "ss01" on;
        }
        .aq ::selection { background: rgba(255, 138, 76, .35); color: #fff; }
        .aq :is(a, button, input, textarea, [role="button"]):focus-visible { outline: 2px solid var(--ember2); outline-offset: 3px; }
        .aq h1, .aq h2, .aq h3, .aq p { margin: 0; }
        .aq em { font-family: var(--serif); font-style: italic; font-weight: 400; color: var(--ember2); }

        /* ---------- Atmosphere ---------- */
        .bg-fx { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
        .blob { position: absolute; border-radius: 50%; will-change: auto; }
        .blob-1 { left: -12vw; top: -16vw; width: 48vw; height: 48vw; background: radial-gradient(circle, rgba(255,122,61,.22), transparent 68%); }
        .blob-2 { right: -14vw; top: 16vh; width: 44vw; height: 44vw; background: radial-gradient(circle, rgba(47,111,147,.24), transparent 68%); }
        .blob-3 { left: 20vw; bottom: -24vw; width: 52vw; height: 42vw; background: radial-gradient(circle, rgba(44,122,107,.16), transparent 68%); }
        .bg-grid {
          position: absolute; inset: 0;
          background-image: linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px);
          background-size: 64px 64px;
          mask-image: radial-gradient(ellipse at 50% 0%, #000 0%, transparent 72%);
          -webkit-mask-image: radial-gradient(ellipse at 50% 0%, #000 0%, transparent 72%);
        }

        /* ---------- Glass ---------- */
        .gl {
          position: relative; isolation: isolate; min-width: 0;
          border: 1px solid var(--line); border-radius: 22px;
          background: linear-gradient(160deg, rgba(255,255,255,.085), rgba(255,255,255,.028));
          box-shadow: inset 0 1px 0 rgba(255,255,255,.12), 0 22px 44px -32px rgba(0,0,0,.72);
        }
        /* The expensive glass blur is reserved for the admin dialog only. */
        .admin-glass {
          background: linear-gradient(145deg, rgba(42,47,60,.78), rgba(14,18,28,.84));
          border: 1px solid rgba(255,255,255,.2);
          backdrop-filter: blur(22px) saturate(160%);
          -webkit-backdrop-filter: blur(22px) saturate(160%);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.22), 0 28px 90px rgba(0,0,0,.58), 0 0 0 1px rgba(255,138,76,.08);
        }
        .gl-lift { transition: transform .4s cubic-bezier(.2,.7,.2,1), border-color .3s ease; }
        .gl-lift:hover { transform: translateY(-4px); border-color: var(--line2); }
        .gl-edge::after {
          content: ""; position: absolute; left: 24px; right: 24px; top: -1px; height: 1px; pointer-events: none;
          background: linear-gradient(90deg, transparent 0%, rgba(255,182,143,.72) 50%, transparent 100%);
        }
        .inset { border: 1px solid var(--line); border-radius: 14px; background: rgba(0,0,0,.34); box-shadow: inset 0 1px 0 rgba(255,255,255,.03); }
        .nav { border-radius: 18px; background: linear-gradient(160deg, rgba(20,22,28,.72), rgba(12,13,17,.66)); }

        /* ---------- Type ---------- */
        .eyebrow { font-family: var(--mono); font-size: 11px; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; color: var(--ember2); }
        .display { font-family: var(--serif); font-weight: 400; letter-spacing: -.02em; line-height: .96; color: var(--ink); }
        .h-sec { font-family: var(--serif); font-weight: 400; font-size: clamp(2rem, 4vw, 3rem); line-height: 1; letter-spacing: -.015em; color: var(--ink); margin-top: 10px; }
        .lead { font-size: 16px; line-height: 1.7; color: var(--ink2); }
        .sub { font-size: 13px; line-height: 1.65; color: var(--ink2); }
        .tiny { font-size: 11.5px; line-height: 1.6; color: var(--ink3); }
        .mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
        .label { display: block; margin-bottom: 8px; font-size: 12px; font-weight: 600; color: var(--ink); }
        .ovl { font-family: var(--mono); font-size: 10px; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3); }

        /* ---------- Controls ---------- */
        .btn { position: relative; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 44px; padding: 0 18px; border-radius: 12px; border: 1px solid transparent; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; white-space: nowrap; transition: transform .2s ease, background-color .2s ease, border-color .2s ease, opacity .2s ease; }
        .btn:disabled { opacity: .45; cursor: not-allowed; }
        .btn:not(:disabled):hover { transform: translateY(-1px); }
        .btn:not(:disabled):active { transform: translateY(0) scale(.985); }
        .btn-sm { height: 36px; padding: 0 13px; font-size: 12px; border-radius: 10px; }
        .btn-primary { color: #1c0d04; background: linear-gradient(180deg, #ffa56d, #ff7d3f); border-color: rgba(255,200,165,.55); box-shadow: inset 0 1px 0 rgba(255,255,255,.45), 0 14px 30px -12px rgba(255,125,63,.65); }
        .btn-primary::after { content: ""; position: absolute; top: 0; bottom: 0; width: 40%; left: -60%; transform: skewX(-20deg); background: linear-gradient(90deg, transparent, rgba(255,255,255,.5), transparent); }
        .btn-primary:not(:disabled):hover::after { animation: shine .9s ease; }
        .btn-ghost { color: var(--ink); background: rgba(255,255,255,.055); border-color: var(--line); }
        .btn-ghost:not(:disabled):hover { background: rgba(255,255,255,.1); border-color: var(--line2); }
        .btn-warm { color: var(--ember2); background: rgba(255,138,76,.1); border-color: rgba(255,138,76,.32); }
        .btn-warm:not(:disabled):hover { background: rgba(255,138,76,.18); }
        .icon-btn { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 10px; border: 1px solid var(--line); background: rgba(255,255,255,.05); color: var(--ink2); cursor: pointer; transition: background-color .2s ease, color .2s ease; }
        .icon-btn:hover:not(:disabled) { background: rgba(255,255,255,.12); color: #fff; }
        .link-btn { background: none; border: 0; padding: 0; font: inherit; font-size: 12px; font-weight: 600; color: var(--ember2); cursor: pointer; }
        .link-btn:hover:not(:disabled) { color: #fff; }
        .link-btn:disabled { opacity: .4; cursor: not-allowed; }

        .field { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 0 12px; border-radius: 14px; border: 1px solid var(--line2); background: rgba(0,0,0,.4); box-shadow: inset 0 1px 2px rgba(0,0,0,.4); transition: border-color .2s ease, box-shadow .2s ease; }
        .field:focus-within { border-color: rgba(255,150,100,.7); box-shadow: 0 0 0 4px rgba(255,138,76,.13), inset 0 1px 2px rgba(0,0,0,.4); }
        .input, .area { width: 100%; min-width: 0; border: 0; outline: 0 !important; background: transparent; color: var(--ink); font: inherit; font-size: 14px; }
        .input { height: 52px; }
        .input::placeholder, .area::placeholder { color: var(--ink3); opacity: 1; }
        .area { display: block; resize: vertical; padding: 14px 16px; line-height: 1.7; border-radius: 14px; border: 1px solid var(--line2); background: rgba(0,0,0,.4); box-shadow: inset 0 1px 2px rgba(0,0,0,.4); transition: border-color .2s ease, box-shadow .2s ease; }
        .area:focus { border-color: rgba(255,150,100,.7); box-shadow: 0 0 0 4px rgba(255,138,76,.13), inset 0 1px 2px rgba(0,0,0,.4); }
        .area-mono { font-family: var(--mono); font-size: 13px; line-height: 1.75; color: #ece8df; }

        .pill { display: inline-flex; align-items: center; gap: 9px; padding: 7px 13px; border-radius: 999px; border: 1px solid var(--line); background: rgba(255,255,255,.05); font-size: 12px; font-weight: 500; color: var(--ink2); }
        .chip { display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px; border-width: 1px; border-style: solid; border-radius: 999px; font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }
        .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--ink3); }
        .dot-ok { background: var(--ok); box-shadow: 0 0 0 3px rgba(123,224,164,.16); }
        .dot-bad { background: var(--bad); box-shadow: 0 0 0 3px rgba(255,141,141,.16); }
        .dot-busy { background: var(--warn); animation: pulse 1.4s ease-in-out infinite; }
        .pulse-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ember); animation: pulse 2.4s ease-in-out infinite; }
        .ico { display: grid; place-items: center; flex-shrink: 0; width: 40px; height: 40px; border-radius: 12px; border: 1px solid rgba(255,255,255,.14); background: linear-gradient(160deg, rgba(255,255,255,.12), rgba(255,255,255,.03)); color: var(--ember2); box-shadow: inset 0 1px 0 rgba(255,255,255,.15); }
        .err { display: flex; align-items: flex-start; gap: 10px; margin-top: 14px; padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(255,141,141,.32); background: rgba(255,90,90,.1); color: #ffd5d5; font-size: 13px; line-height: 1.6; }

        /* ---------- Hero ---------- */
        .steps { position: relative; display: grid; gap: 4px; }
        .steps::before { content: ""; position: absolute; left: 19px; top: 24px; bottom: 24px; width: 1px; background: var(--line); }
        .steps-fill { position: absolute; left: 19px; top: 24px; bottom: 24px; width: 1px; background: linear-gradient(var(--ember), rgba(255,182,143,.3)); opacity: .72; }
        .step { position: relative; display: grid; grid-template-columns: 40px minmax(0,1fr) auto; align-items: center; gap: 14px; padding: 10px 12px; border-radius: 14px; border: 1px solid transparent; animation: step-highlight 9.6s ease-in-out infinite both; }
        .steps .step:nth-of-type(2) { animation-delay: -7.2s; }
        .steps .step:nth-of-type(3) { animation-delay: -4.8s; }
        .steps .step:nth-of-type(4) { animation-delay: -2.4s; }
        .step .ico { color: var(--ink3); background: #14161c; animation: step-icon-highlight 9.6s ease-in-out infinite both; }
        .steps .step:nth-of-type(2) .ico { animation-delay: -7.2s; }
        .steps .step:nth-of-type(3) .ico { animation-delay: -4.8s; }
        .steps .step:nth-of-type(4) .ico { animation-delay: -2.4s; }
        .step-t { font-size: 14px; font-weight: 600; color: var(--ink2); }
        .step-d { margin-top: 2px; font-size: 12px; color: var(--ink3); }
        .step-tag { font-family: var(--mono); font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: var(--ink3); }
        .step-on { background: rgba(255,255,255,.06); border-color: var(--line); }
        .step-on .ico { color: var(--ember2); border-color: rgba(255,138,76,.5); }
        .step-on .step-t { color: #fff; }
        .step-on .step-tag { color: var(--ember2); }

        .marquee { overflow: hidden; border-block: 1px solid var(--line); mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent); -webkit-mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent); }
        .marquee-track { display: flex; width: max-content; gap: 44px; padding: 18px 0; animation: marquee 42s linear infinite; }
        .marquee:hover .marquee-track { animation-play-state: paused; }
        .tech { font-family: var(--mono); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); white-space: nowrap; }
        .tech::before { content: "◆"; margin-right: 44px; color: rgba(255,138,76,.55); font-size: 8px; vertical-align: middle; }

        .stat { padding: 24px; }
        .stat-n { font-family: var(--serif); font-size: clamp(2.6rem, 5vw, 3.6rem); line-height: 1; letter-spacing: -.02em; color: var(--ink); }
        .stat-l { margin-top: 10px; font-size: 13px; color: var(--ink2); }

        /* ---------- Workspace ---------- */
        .panel-head { display: flex; align-items: flex-start; gap: 14px; padding: 22px 24px; border-bottom: 1px solid var(--line); }
        .panel-body { padding: 24px; }
        .panel-title { font-size: 16px; font-weight: 600; letter-spacing: -.01em; color: var(--ink); }
        .flow { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
        .flow-i { position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; }
        .flow-i:not(:last-child)::after { content: ""; position: absolute; top: 20px; left: calc(50% + 24px); width: calc(100% - 48px); height: 1px; background: repeating-linear-gradient(90deg, var(--line2) 0 4px, transparent 4px 8px); }
        .flow-i .ico { width: 40px; height: 40px; }
        .bar { height: 6px; overflow: hidden; border-radius: 999px; background: rgba(255,255,255,.09); }
        .bar > i { position: relative; display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #ff7d3f, #ffb68f); transition: width .8s cubic-bezier(.2,.7,.2,1); }
        .bar-live > i::after { content: ""; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, rgba(255,255,255,.65), transparent); transform: translateX(-100%); animation: sweep 1.6s ease-in-out infinite; }
        .notice { display: flex; align-items: flex-start; gap: 12px; padding: 14px; border-radius: 14px; border: 1px solid var(--line); background: rgba(255,255,255,.04); }
        .notice-warm { border-color: rgba(255,138,76,.38); background: rgba(255,138,76,.09); }
        .notice-bad { border-color: rgba(255,141,141,.34); background: rgba(255,90,90,.09); }
        .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 20px; }
        .meta b { display: block; margin-top: 6px; font-size: 13px; font-weight: 600; color: var(--ink); overflow-wrap: anywhere; }
        .empty { display: flex; min-height: 320px; flex-direction: column; align-items: center; justify-content: center; padding: 32px 20px; text-align: center; border: 1px dashed var(--line2); border-radius: 18px; background: rgba(0,0,0,.28); }
        .empty .ico { width: 64px; height: 64px; border-radius: 20px; animation: float 5s ease-in-out infinite; }

        /* ---------- Table ---------- */
        .tbl { width: 100%; min-width: 760px; border-collapse: collapse; text-align: left; }
        .tbl th { padding: 16px 20px; font-family: var(--mono); font-size: 10px; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; color: var(--ink3); border-bottom: 1px solid var(--line); background: rgba(255,255,255,.03); }
        .tbl td { padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,.06); }
        .tbl tr:last-child td { border-bottom: 0; }
        .tbl tbody tr { transition: background-color .2s ease; }
        .tbl tbody tr:hover { background: rgba(255,255,255,.04); }

        /* ---------- Engineering ---------- */
        .feat { padding: 24px; }
        .feat-n { font-family: var(--mono); font-size: 11px; letter-spacing: .12em; color: var(--ink3); }
        .stack-row { padding: 14px 0; border-top: 1px solid var(--line); }
        .stack-row:first-child { border-top: 0; padding-top: 0; }
        .cap { display: flex; align-items: flex-start; gap: 14px; padding: 14px 0; border-top: 1px solid var(--line); transition: transform .25s ease; }
        .cap:first-of-type { border-top: 0; }
        .cap:hover { transform: translateX(4px); }
        .cap .ico { width: 36px; height: 36px; border-radius: 10px; }

        /* ---------- Markdown ---------- */
        .markdown-body { color: #e3dfd5; font-size: 15px; line-height: 1.85; overflow-wrap: anywhere; }
        .markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4 { color: #fff; font-weight: 650; line-height: 1.25; margin: 1.5em 0 .55em; letter-spacing: -.01em; }
        .markdown-body h1 { font-size: 1.8rem; } .markdown-body h2 { font-size: 1.4rem; } .markdown-body h3 { font-size: 1.15rem; }
        .markdown-body p { margin: .85em 0; } .markdown-body ul, .markdown-body ol { padding-left: 1.5rem; margin: .8em 0; }
        .markdown-body li { margin: .3em 0; } .markdown-body strong { color: #fff; }
        .markdown-body a { color: var(--ember2); text-decoration: underline; text-underline-offset: 3px; }
        .markdown-body blockquote { margin: 1em 0; padding: .25em 0 .25em 1rem; border-left: 3px solid var(--ember); color: var(--ink2); }
        .markdown-body code { padding: .1rem .35rem; border: 1px solid var(--line2); border-radius: 6px; background: rgba(0,0,0,.45); color: var(--ember2); font-family: var(--mono); font-size: .88em; }
        .markdown-body pre { overflow-x: auto; padding: 1rem; border: 1px solid var(--line2); border-radius: 12px; background: rgba(0,0,0,.5); }
        .markdown-body pre code { padding: 0; border: 0; background: transparent; color: #ece8df; }
        .markdown-body table { width: 100%; margin: 1rem 0; border-collapse: collapse; font-size: .92rem; }
        .markdown-body th, .markdown-body td { padding: .6rem .8rem; border: 1px solid var(--line2); text-align: left; }
        .markdown-body th { background: rgba(255,255,255,.07); color: #fff; }
        .markdown-body tr:nth-child(even) { background: rgba(255,255,255,.025); }
        .markdown-body hr { margin: 1.6rem 0; border: 0; border-top: 1px solid var(--line2); }

        /* ---------- Keyframes ---------- */
        @keyframes step-highlight {
          0%, 23% { background: rgba(255,255,255,.06); border-color: var(--line); }
          25%, 100% { background: transparent; border-color: transparent; }
        }
        @keyframes step-icon-highlight {
          0%, 23% { color: var(--ember2); border-color: rgba(255,138,76,.5); transform: scale(1.04); }
          25%, 100% { color: var(--ink3); border-color: rgba(255,255,255,.14); transform: scale(1); }
        }
        @keyframes shine { from { left: -60%; } to { left: 140%; } }
        @keyframes sweep { to { transform: translateX(100%); } }
        @keyframes marquee { to { transform: translateX(-50%); } }
        @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }

        @media (max-width: 640px) {
          .panel-head, .panel-body { padding: 18px; }
          .step { grid-template-columns: 40px minmax(0,1fr); }
          .step-tag { display: none; }
        }
        @media (prefers-reduced-motion: reduce) {
          .aq *, .aq *::before, .aq *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
        }
      `}</style>

      <div aria-hidden="true" className="bg-fx">
        <div className="blob blob-1" />
        <div className="blob blob-2" />
        <div className="blob blob-3" />
        <div className="bg-grid" />
      </div>

      <div className="relative z-10">
        {/* ---------------- Header ---------------- */}
        <header className="sticky top-3 z-40 px-3 sm:px-5">
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.2, 0.7, 0.2, 1] }}
            className="gl nav mx-auto flex max-w-[1360px] items-center justify-between gap-3 px-3 py-2.5 sm:px-4"
          >
            <a href="#top" className="flex min-w-0 items-center gap-3" aria-label="AegisIQ home">
              <span className="ico" style={{ width: 38, height: 38, color: "#1c0d04", background: "linear-gradient(180deg,#ffa56d,#ff7d3f)", borderColor: "rgba(255,200,165,.6)" }}>
                <ShieldCheck className="h-[19px] w-[19px]" strokeWidth={2} />
              </span>
              <span className="min-w-0 leading-none">
                <span className="block text-[17px] font-semibold tracking-tight text-[var(--ink)]">Aegis<em style={{ fontSize: 20 }}>IQ</em></span>
                <span className="ovl mt-1 hidden sm:block" style={{ fontSize: 9 }}>Tender intelligence</span>
              </span>
            </a>

            <nav className="hidden items-center gap-1 lg:flex" aria-label="Main navigation">
              {[["#workspace", "Workspace"], ["#history", "Run history"], ["#engineering", "Engineering"]].map(([href, label]) => (
                <a key={href} href={href} className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-[var(--ink2)] transition hover:bg-white/[0.07] hover:text-white">{label}</a>
              ))}
            </nav>

            <div className="flex items-center gap-2">
              <div className="pill hidden md:inline-flex" aria-live="polite">
                <span className={`dot ${apiIndicator.kind === "ok" ? "dot-ok" : apiIndicator.kind === "bad" ? "dot-bad" : apiIndicator.kind === "busy" ? "dot-busy" : ""}`} />
                {apiIndicator.label}
              </div>
              <button type="button" onClick={checkApi} disabled={apiCheckBusy} className="btn btn-ghost btn-sm">
                {apiCheckBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">Check API</span><span className="sm:hidden">API</span>
              </button>
              <button type="button" onClick={openAdmin} className="btn btn-warm btn-sm">
                <Database className="h-3.5 w-3.5" /><span className="hidden sm:inline">Knowledge admin</span><span className="sm:hidden">RAG</span>
              </button>
            </div>
          </motion.div>
        </header>

        <main id="top" className="mx-auto max-w-[1360px] px-4 pb-10 sm:px-6 lg:px-8">
          {/* ---------------- Hero ---------------- */}
          <section className="hero grid items-center gap-12 pb-12 pt-14 lg:grid-cols-[1.05fr_.95fr] lg:gap-14 lg:pb-20 lg:pt-24">
            <div>
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="pill">
                <span className="pulse-dot" />Agentic tender intelligence
              </motion.div>
              <h1 className="display mt-7 text-[clamp(3.2rem,8.2vw,6.6rem)]" aria-label="RFP in. Approved proposal out.">
                <motion.span className="block" initial={{ opacity: 0, y: 34,  }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.1, ease: [0.2, 0.7, 0.2, 1] }}>RFP in.</motion.span>
                <motion.span className="block" initial={{ opacity: 0, y: 34,  }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.25, ease: [0.2, 0.7, 0.2, 1] }}><em>Approved</em> proposal out.</motion.span>
              </h1>
              <motion.p initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.45 }} className="lead mt-7 max-w-[500px]">
                AegisIQ reads the tender, grounds the draft in your portfolio, and holds it for human sign-off.
              </motion.p>
              <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.58 }} className="mt-9 flex flex-wrap gap-3">
                <a href="#workspace" className="btn btn-primary">Open workspace <ArrowRight className="h-4 w-4" /></a>
                <a href="#engineering" className="btn btn-ghost">See the build <ArrowUpRight className="h-4 w-4" /></a>
              </motion.div>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.8 }} className="tiny mono mt-12">
                Built by <span className="text-[var(--ink)]">Mr Faizan</span> · Python · Agentic AI · RAG
              </motion.p>
            </div>

            <div className="hero-parallax">
              <motion.div initial={{ opacity: 0, y: 28, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.9, delay: 0.3, ease: [0.2, 0.7, 0.2, 1] }} className="gl gl-edge mx-auto w-full max-w-[560px] p-5 sm:p-6">
                <div className="mb-5 flex items-center justify-between gap-3 border-b border-[var(--line)] pb-4">
                  <div><div className="ovl">Execution map</div><div className="mt-1.5 text-[15px] font-semibold">RFP → reviewed proposal</div></div>
                  <span className="chip border-[rgba(255,138,76,.4)] bg-[rgba(255,138,76,.1)] text-[var(--ember2)]"><span className="pulse-dot" />Human-controlled</span>
                </div>
                <div className="steps">
                  <span className="steps-fill" />
                  {HERO_STEPS.map((step, index) => {
                    const StepIcon = step.icon;
                    return (
                      <div key={step.title} className="step">
                        <span className="ico"><StepIcon className="h-[18px] w-[18px]" /></span>
                        <div className="min-w-0"><div className="step-t">{step.title}</div><div className="step-d">{step.detail}</div></div>
                        <span className="step-tag">{step.tag}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="mono mt-5 flex items-center justify-between border-t border-[var(--line)] pt-4 text-[10px] tracking-[.12em] text-[var(--ink3)]">
                  <span>FASTAPI · CELERY · LANGGRAPH</span><span className="flex items-center gap-2"><span className="dot dot-ok" />Live</span>
                </div>
              </motion.div>
            </div>
          </section>

          {/* ---------------- Marquee + stats ---------------- */}
          <div className="marquee" aria-label="Technology stack">
            <div className="marquee-track">{[...TECH, ...TECH].map((item, index) => <span key={`${item}-${index}`} className="tech">{item}</span>)}</div>
          </div>

          <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Project facts">
            {[
              { n: 3, l: "Agent nodes" },
              { n: 3, l: "Extraction fallbacks" },
              { n: 10, l: "Runs kept locally" },
              { n: 1, l: "Human release gate" },
            ].map((item, index) => (
              <motion.div key={item.l} {...rise(index * 0.07)} className="gl gl-lift stat">
                <div className="stat-n"><CountUp to={item.n} /></div>
                <div className="stat-l">{item.l}</div>
              </motion.div>
            ))}
          </section>

          {/* ---------------- Workspace ---------------- */}
          <section id="workspace" className="mt-24 scroll-mt-28">
            <motion.div {...rise()} className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
              <div>
                <Kicker>01 — Workspace</Kicker>
                <h2 className="h-sec">Proposal <em>workspace</em></h2>
                <p className="sub mt-3 max-w-xl">Paste a public RFP link. Track it live. Approve when it’s ready.</p>
              </div>
              <div className="gl flex items-center gap-3 px-4 py-3" style={{ borderRadius: 16 }}>
                <span className="ico" style={{ width: 36, height: 36 }}><ShieldCheck className="h-[17px] w-[17px]" /></span>
                <div><div className="text-[13px] font-semibold">Human review gate</div><div className="tiny">Final approval stays with you</div></div>
              </div>
            </motion.div>

            <div className="grid items-stretch gap-4 xl:grid-cols-[.92fr_1.08fr]">
              <motion.div {...rise()} className="gl gl-edge flex flex-col">
                <div className="panel-head">
                  <span className="ico"><Globe2 className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1"><div className="panel-title">New proposal</div><p className="sub mt-1">Paste a public RFP or job-post link.</p></div>
                  <span className="ovl mt-1">Input</span>
                </div>
                <div className="panel-body flex-1">
                  <form onSubmit={handleGenerate} noValidate>
                    <label htmlFor="rfpUrl" className="label">Tender / RFP URL <span style={{ color: "var(--ember)" }}>*</span></label>
                    <div className="field">
                      <Globe2 className="h-4 w-4 shrink-0 text-[var(--ink3)]" />
                      <input id="rfpUrl" type="url" value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="https://example.com/tender-or-rfp" autoComplete="url" spellCheck={false} className="input" aria-describedby="rfp-url-help" />
                      {urlInput && <button type="button" aria-label="Clear URL" title="Clear URL" onClick={() => setUrlInput("")} className="icon-btn" style={{ width: 28, height: 28 }}><X className="h-4 w-4" /></button>}
                    </div>
                    <p id="rfp-url-help" className="tiny mt-2.5">Public pages only. Login walls and bot checks may block extraction.</p>

                    <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
                      <button type="submit" disabled={isSubmitting} className="btn btn-primary" style={{ height: 50 }}>
                        {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {isSubmitting ? "Submitting…" : "Generate proposal"}{!isSubmitting && <ArrowRight className="h-4 w-4" />}
                      </button>
                      <span className="tiny flex items-center gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-[var(--ok)]" />Never auto-approved</span>
                    </div>
                    {formAlert && <ErrorMessage>{formAlert}</ErrorMessage>}
                  </form>

                  <div className="inset mt-7 p-5">
                    <div className="mb-5 flex items-center justify-between"><span className="ovl">Workflow</span><span className="tiny flex items-center gap-2"><span className="dot dot-ok" />Evidence first</span></div>
                    <div className="flow">
                      {FLOW.map((item) => {
                        const FlowIcon = item.icon;
                        return (
                          <div key={item.label} className="flow-i">
                            <span className="ico"><FlowIcon className="h-[18px] w-[18px]" /></span>
                            <div><div className="text-[12px] font-semibold">{item.label}</div><div className="tiny" style={{ fontSize: 10.5 }}>{item.detail}</div></div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </motion.div>

              <motion.div {...rise(0.08)} aria-live="polite" className="gl gl-edge flex flex-col">
                <div className="panel-head">
                  <span className="ico"><Activity className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1"><div className="panel-title">Live monitor</div><p className="sub mt-1">Task state, progress and review.</p></div>
                  <span className={`chip ${runInfo.badgeClass}`}><span className={`dot ${isLive ? "dot-busy" : ""}`} style={{ background: "currentColor", width: 6, height: 6 }} />{runInfo.label}</span>
                </div>
                <div className="panel-body flex-1">
                  {!hasMonitor ? (
                    <div className="empty">
                      <span className="ico"><FileText className="h-7 w-7" strokeWidth={1.4} /></span>
                      <div className="ovl mt-6">Ready</div>
                      <h3 className="mt-2 text-[17px] font-semibold">No active task</h3>
                      <p className="sub mt-2 max-w-xs">Generate a proposal to track it here.</p>
                      <div className="mt-5 flex flex-wrap justify-center gap-2">
                        <span className="pill"><CircleDot className="h-3 w-3 text-[var(--ember)]" />Live polling</span>
                        <span className="pill"><ShieldCheck className="h-3 w-3 text-[var(--ok)]" />Human review</span>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0"><div className="ovl">Current run</div><div className="mt-1.5 truncate text-[18px] font-semibold tracking-tight">{hostFromUrl(activeRun?.url)}</div></div>
                        <button type="button" aria-label="Refresh task status" title="Refresh task status" onClick={manualRefresh} disabled={refreshBusy} className="icon-btn">{refreshBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</button>
                      </div>
                      <a href={safeUrl(activeRun?.url || "") || "#"} target="_blank" rel="noopener noreferrer" title={activeRun?.url || ""} className="mt-2 flex min-w-0 items-center gap-2 text-[12px] text-[var(--ember2)] hover:text-white"><span className="min-w-0 truncate">{activeRun?.url || "No URL"}</span><ExternalLink className="h-3.5 w-3.5 shrink-0" /></a>

                      <div className="mb-2 mt-5 flex items-center justify-between"><span className="ovl">Task ID</span><button type="button" onClick={() => void copyText(activeRun?.pollTaskId || activeRun?.taskId || "", "Current task ID copied.")} disabled={!(activeRun?.pollTaskId || activeRun?.taskId)} className="link-btn">Copy</button></div>
                      <code className="inset mono block break-all px-4 py-3 text-[12px] leading-5 text-[var(--ink2)]">{activeRun?.pollTaskId || activeRun?.taskId || "Not created yet"}</code>

                      <div className={`notice mt-4 ${activeRun?.state === "waiting_review" ? "notice-warm" : activeRun?.state === "failed" ? "notice-bad" : ""}`}>
                        <span className="ico" style={{ width: 36, height: 36, borderRadius: 10 }}><Clock3 className="h-[17px] w-[17px]" /></span>
                        <div className="min-w-0"><div className="text-[13px] font-semibold">{runInfo.title}</div><p className="sub mt-1 break-words" style={{ fontSize: 12 }}>{activeRun?.error || activeRun?.message || runInfo.message}</p></div>
                      </div>

                      <div className={`bar mt-5 ${isLive ? "bar-live" : ""}`}><i style={{ width: `${runInfo.progress}%` }} /></div>
                      <div className="tiny mt-2 flex items-center justify-between"><span>{runInfo.caption}</span><span className="mono">{elapsed(activeRun)}</span></div>

                      <div className="my-5 h-px bg-[var(--line)]" />
                      <div className="meta">
                        <div><div className="ovl">Human review</div><b>{reviewLabel}</b></div>
                        <div>
                          <div className="ovl">Critic status</div>
                          <b
                            className={
                              String(activeRun?.criticStatus || "").toUpperCase() === "APPROVED"
                                ? "text-emerald-300"
                                : String(activeRun?.criticStatus || "").toUpperCase() === "REVISION_NEEDED"
                                  ? "text-amber-200"
                                  : String(activeRun?.criticStatus || "").toUpperCase() === "CRITIC_ERROR"
                                    ? "text-red-300"
                                    : "text-[var(--ink2)]"
                            }
                          >
                            {activeRun?.criticStatus || "Pending"}
                          </b>
                        </div>
                        <div><div className="ovl">Last updated</div><b>{formatDate(activeRun?.updatedAt || activeRun?.createdAt)}</b></div>
                        <div><div className="ovl">RAG context</div><b>{activeRun?.ragWarning ? "Warning" : ["waiting_review", "completed"].includes(activeRun?.state || "") ? "Checked" : "In progress"}</b></div>
                      </div>
                      {activeRun?.ragWarning && <div className="notice notice-warm mt-4 text-[13px] leading-6 text-[var(--ember2)]">RAG warning: {activeRun.ragWarning}</div>}
                      {activeRun?.error && <div className="notice notice-bad mt-4 text-[13px] leading-6 text-[#ffd5d5]">Task error: {activeRun.error}</div>}
                      {activeRun?.state === "waiting_review" && (
                        <div className="notice notice-warm mt-4">
                          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ember2)]" />
                          <div><div className="text-[13px] font-semibold">Review required</div><p className="sub mt-1" style={{ fontSize: 12 }}>Paused at the approval checkpoint. Edit the draft below before finalizing.</p></div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          </section>

          {/* ---------------- Review gate ---------------- */}
          <section id="proposal-panel" className="mt-4 scroll-mt-28">
            <motion.div {...rise()} className="gl gl-edge">
              <div className="panel-head flex-col lg:flex-row lg:items-center" style={{ padding: "24px 28px" }}>
                <div className="flex min-w-0 flex-1 items-start gap-4">
                  <span className="ico"><FileText className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <Kicker>02 — Review gate</Kicker>
                    <h2 className="mt-1.5 text-[20px] font-semibold tracking-tight">{hasFinal ? "Final proposal" : hasReviewDraft ? "Review the draft" : activeRun?.state === "resuming" ? "Processing proposal" : activeRun?.state === "failed" ? "Generation failed" : "Proposal review"}</h2>
                    <p className="sub mt-1">{hasFinal ? "Approved through the human checkpoint." : hasReviewDraft ? "Edit, add notes, then approve or request a revision." : "The draft appears here once review is reached."}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`chip ${hasFinal ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100" : hasReviewDraft ? "border-orange-300/35 bg-orange-300/10 text-orange-100" : activeRun?.state === "failed" ? "border-red-300/30 bg-red-300/10 text-red-100" : "border-white/15 bg-white/[0.05] text-[var(--ink2)]"}`}>{hasFinal ? "Approved" : hasReviewDraft ? "Review required" : activeRun?.state === "resuming" ? "Processing" : activeRun?.state === "failed" ? "Task failed" : "No draft"}</span>
                  <button type="button" disabled={!hasDraft} onClick={downloadProposal} className="btn btn-ghost btn-sm"><Download className="h-3.5 w-3.5" />Download .md</button>
                  <button type="button" disabled={!hasDraft} onClick={() => void copyText(getProposalText(), hasFinal ? "Final proposal copied." : "Current proposal text copied.")} className="btn btn-ghost btn-sm"><Copy className="h-3.5 w-3.5" />Copy</button>
                </div>
              </div>

              <div className="p-5 sm:p-7">
                {!hasDraft ? (
                  <div className="empty" style={{ minHeight: 200 }}>
                    <span className="ico" style={{ width: 52, height: 52 }}><FileText className="h-5 w-5" strokeWidth={1.5} /></span>
                    <div className="mt-4 text-[15px] font-semibold">Nothing to review yet</div>
                    <p className="sub mt-1.5 max-w-md">The editable draft shows up when the task pauses for review.</p>
                  </div>
                ) : hasReviewDraft ? (
                  <div className="space-y-5">
                    <div className="notice notice-warm items-center justify-between">
                      <div className="flex min-w-0 flex-wrap items-center gap-2 text-[13px] font-semibold"><span className={`dot ${String(activeRun?.criticStatus || "").toUpperCase() === "APPROVED" ? "dot-ok" : "dot-busy"}`} />{activeRun?.criticStatus === "APPROVED" ? "Critic approved · Awaiting your decision" : "Draft editor · Awaiting your decision"}{activeRun?.criticStatus && activeRun.criticStatus !== "APPROVED" && <span className="font-normal text-[var(--ink2)]">/ Critic: {activeRun.criticStatus}</span>}</div>
                      <div className="mono shrink-0 text-[11px] text-[var(--ink2)]">{words.toLocaleString()} {words === 1 ? "word" : "words"}</div>
                    </div>
                    <textarea aria-label="Proposal draft" value={editorValue} onChange={(event) => setEditorValue(event.target.value)} spellCheck className="area area-mono" style={{ minHeight: 440 }} placeholder="The proposal draft will appear here…" disabled={Boolean(resumeBusy)} />
                    <div className="tiny flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 shrink-0 text-[var(--ok)]" />Verify every claim before sending.</span><span style={{ color: editorEdited ? "var(--warn)" : undefined }}>{editorEdited ? "Edited — approval sends this text" : "Loaded from backend"}</span></div>
                    <div className="grid gap-5 border-t border-[var(--line)] pt-6 lg:grid-cols-[1fr_auto] lg:items-end">
                      <div className="min-w-0">
                        <label htmlFor="reviewFeedback" className="label">Reviewer note <span className="font-normal text-[var(--ink3)]">(optional for approval)</span></label>
                        <textarea id="reviewFeedback" value={reviewFeedback} onChange={(event) => setReviewFeedback(event.target.value)} onKeyDown={onFeedbackKeyDown} rows={3} placeholder="What should change? Or leave an audit note…" className="area" style={{ fontSize: 13 }} disabled={Boolean(resumeBusy)} />
                        <p className="tiny mt-2">Ctrl/Cmd + Enter requests a revision.</p>
                      </div>
                      <div className="flex flex-col gap-2.5 sm:flex-row lg:min-w-[250px] lg:flex-col">
                        <button type="button" disabled={Boolean(resumeBusy) || activeRun?.state !== "waiting_review"} onClick={() => void resumeWorkflow("REVISE")} className="btn btn-warm"><RotateCcw className="h-4 w-4" />Request revision</button>
                        <button type="button" disabled={Boolean(resumeBusy) || activeRun?.state !== "waiting_review"} onClick={() => void resumeWorkflow("APPROVE")} className="btn btn-primary"><Check className="h-4 w-4" />Approve &amp; finalize</button>
                      </div>
                    </div>
                  </div>
                ) : activeRun?.state === "resuming" ? (
                  <div className="notice notice-warm py-6">
                    <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-[var(--ember2)]" />
                    <div>
                      <div className="text-[14px] font-semibold">Backend processing</div>
                      <p className="sub mt-1">
                        {activeRun.message || "The Celery worker is processing your approval or revision request."}
                      </p>
                      <p className="tiny mt-2">The result will appear here automatically.</p>
                    </div>
                  </div>
                ) : hasFinal ? (
                  <div>
                    <div className="notice mb-6 items-center" style={{ borderColor: "rgba(123,224,164,.35)", background: "rgba(123,224,164,.08)" }}>
                      <span className="ico" style={{ color: "var(--ok)" }}><CheckCircle2 className="h-5 w-5" /></span>
                      <div><div className="text-[14px] font-semibold">Proposal finalized</div><p className="sub mt-0.5" style={{ fontSize: 12 }}>Approval recorded. Copy or download below.</p></div>
                    </div>
                    <article className="markdown-body inset max-w-none px-5 py-6 sm:px-9 sm:py-8"><ReactMarkdown remarkPlugins={[remarkGfm]}>{finalText}</ReactMarkdown></article>
                  </div>
                ) : (
                  <div className="notice notice-bad text-[14px] leading-6 text-[#ffd5d5]">No reviewable proposal was produced. Check the monitor and worker logs.</div>
                )}
                {resumeBusy && (
                  <div className="notice notice-warm mt-5">
                    <LoaderCircle className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-[var(--ember2)]" />
                    <div><div className="text-[13px] font-semibold">{resumeBusy.title}</div><p className="sub mt-1" style={{ fontSize: 12 }}>{resumeBusy.message}</p></div>
                  </div>
                )}
                {proposalAlert && <ErrorMessage>{proposalAlert}</ErrorMessage>}
              </div>
            </motion.div>
          </section>

          {/* ---------------- History ---------------- */}
          <section id="history" className="mt-24 scroll-mt-28">
            <motion.div {...rise()} className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <Kicker>03 — Local records</Kicker>
                <h2 className="h-sec">Recent <em>runs</em></h2>
                <p className="sub mt-3 max-w-xl">Last 10 runs, stored in this browser only. Clearing them doesn’t touch backend tasks.</p>
              </div>
              <button type="button" onClick={clearHistory} disabled={!history.length} className="btn btn-ghost btn-sm w-fit"><History className="h-4 w-4" />Clear history</button>
            </motion.div>
            <motion.div {...rise(0.05)} className="gl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>RFP / URL</th><th>Created</th><th>State</th><th>Task ID</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
                  <tbody>
                    {history.length === 0 ? (
                      <tr><td colSpan={5} style={{ padding: "48px 20px", textAlign: "center" }}>
                        <div className="mx-auto flex max-w-sm flex-col items-center"><span className="ico"><History className="h-4 w-4" /></span><span className="sub mt-3">No runs yet. Submitted tasks appear here.</span></div>
                      </td></tr>
                    ) : history.map((run, index) => (
                      <tr key={run.taskId || `run-${index}`}>
                        <td className="max-w-[300px]"><div className="truncate text-[13px] font-medium" title={run.url}>{run.url || "Untitled run"}</div></td>
                        <td className="mono whitespace-nowrap text-[11px] text-[var(--ink2)]">{formatDate(run.createdAt)}</td>
                        <td><span className={`chip ${historyStateClass(run.state)}`}><span className="dot" style={{ background: "currentColor", width: 6, height: 6 }} />{historyStateLabel(run.state)}</span></td>
                        <td className="max-w-[185px]"><code className="mono block truncate text-[11px] text-[var(--ink3)]" title={run.pollTaskId || run.taskId || "—"}>{run.pollTaskId || run.taskId || "—"}</code></td>
                        <td><div className="flex justify-end gap-1.5">
                          <button type="button" onClick={() => selectHistoryRun(run.taskId)} className="btn btn-warm btn-sm" style={{ height: 32 }}>Open</button>
                          <button type="button" aria-label="Remove run from local history" title="Remove from local history" onClick={() => removeHistoryRun(run.taskId)} className="icon-btn" style={{ width: 32, height: 32 }}><X className="h-4 w-4" /></button>
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </motion.div>
          </section>

          {/* ---------------- Engineering ---------------- */}
          <section id="engineering" className="mt-24 scroll-mt-28" aria-labelledby="project-profile-title">
            <motion.div {...rise()} className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
              <div>
                <Kicker>04 — Engineering</Kicker>
                <h2 id="project-profile-title" className="h-sec">Built <em>end to end</em></h2>
                <p className="sub mt-3 max-w-xl">Extraction, RAG, agent review, async execution and human approval in one flow.</p>
              </div>
              <div className="gl px-4 py-3" style={{ borderRadius: 16 }}><div className="ovl">Author</div><div className="mt-1 text-[14px] font-semibold">Mr Faizan <span className="font-normal text-[var(--ink3)]">· Python / AI engineering</span></div></div>
            </motion.div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {FEATURES.map((item, index) => {
                const FeatIcon = item.icon;
                return (
                  <motion.article key={item.n} {...rise(index * 0.07)} className="gl gl-lift feat">
                    <div className="flex items-center justify-between"><span className="ico"><FeatIcon className="h-5 w-5" /></span><span className="feat-n">{item.n}</span></div>
                    <h3 className="mt-5 text-[15px] font-semibold tracking-tight">{item.title}</h3>
                    <p className="sub mt-2">{item.text}</p>
                  </motion.article>
                );
              })}
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
              <motion.div {...rise()} className="gl p-6 sm:p-7">
                <div className="mb-6 flex items-center gap-3"><span className="ico" style={{ width: 36, height: 36 }}><Activity className="h-4 w-4" /></span><div><div className="ovl">Tools</div><h3 className="mt-0.5 text-[16px] font-semibold">Tech stack</h3></div></div>
                {STACK.map((row) => (
                  <div key={row.label} className="stack-row"><div className="ovl" style={{ color: "var(--ember2)" }}>{row.label}</div><p className="mt-1.5 text-[13.5px] leading-6 text-[var(--ink)]">{row.value}</p></div>
                ))}
              </motion.div>
              <motion.div {...rise(0.08)} className="gl p-6 sm:p-7">
                <div className="mb-5 flex items-center gap-3"><span className="ico" style={{ width: 36, height: 36 }}><FileText className="h-4 w-4" /></span><div><div className="ovl">Capabilities</div><h3 className="mt-0.5 text-[16px] font-semibold">Built in</h3></div></div>
                {CAPS.map((cap) => {
                  const CapIcon = cap.icon;
                  return (
                    <div key={cap.title} className="cap"><span className="ico"><CapIcon className="h-4 w-4" /></span><div><div className="text-[13.5px] font-semibold">{cap.title}</div><p className="tiny mt-0.5" style={{ fontSize: 12.5 }}>{cap.text}</p></div></div>
                  );
                })}
              </motion.div>
            </div>

            <motion.div {...rise()} className="gl mt-4 flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between" style={{ borderRadius: 16 }}>
              <div className="flex items-center gap-2.5 text-[13px] font-medium"><ShieldCheck className="h-4 w-4 text-[var(--ok)]" />Source-grounded output. Human approval is the final gate.</div>
              <div className="tiny mono">AegisIQ · by Mr Faizan</div>
            </motion.div>
          </section>
        </main>

        <footer className="relative mt-10 border-t border-[var(--line)]">
          <div className="mx-auto flex max-w-[1360px] flex-col gap-3 px-4 py-7 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
            <div className="flex items-center gap-3"><span className="ico" style={{ width: 32, height: 32, borderRadius: 9, fontWeight: 700 }}>A</span><div><div className="text-[13px] font-semibold">AegisIQ</div><div className="tiny" style={{ fontSize: 11 }}>Agentic tender intelligence</div></div></div>
            <div className="tiny">Designed &amp; built by <span className="text-[var(--ink)]">Mr Faizan</span></div>
            <a href="#top" className="link-btn">Back to top ↑</a>
          </div>
        </footer>
      </div>

      {/* ---------------- Knowledge admin ---------------- */}
      <AnimatePresence>
        {adminOpen && (
          <motion.div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4" style={{ background: "rgba(5,6,8,.78)" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) closeAdmin(); }}>
            <motion.div role="dialog" aria-modal="true" aria-labelledby="admin-modal-title" initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }} transition={{ duration: 0.3, ease: [0.2, 0.7, 0.2, 1] }} className="gl gl-edge admin-glass my-auto w-full max-w-xl overflow-hidden">
              <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] px-6 py-5">
                <div><Kicker>Knowledge base</Kicker><h2 id="admin-modal-title" className="mt-1.5 text-[20px] font-semibold tracking-tight">Knowledge admin</h2><p className="sub mt-1">Upload a file to the portfolio RAG.</p></div>
                <button type="button" onClick={closeAdmin} aria-label="Close admin modal" className="icon-btn"><X className="h-4 w-4" /></button>
              </div>
              <div className="space-y-5 px-6 py-6">
                <div>
                  <label htmlFor="adminTokenInput" className="label">X-Admin-Token <span style={{ color: "var(--ember)" }}>*</span></label>
                  <div className="field"><input id="adminTokenInput" type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="Enter admin token…" className="input" style={{ height: 46 }} /></div>
                  <p className="tiny mt-2">Sent as the <code className="mono text-[var(--ember2)]">X-Admin-Token</code> header.</p>
                </div>
                <div>
                  <label className="label">Knowledge file</label>
                  <input ref={fileInputRef} type="file" accept=".pdf,.txt,.csv,.md" onChange={handleFileChange} className="hidden" aria-label="Choose RAG knowledge file" />
                  <div role="button" tabIndex={0} onClick={() => fileInputRef.current?.click()} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click(); }} onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleFileDrop}
                    className="flex cursor-pointer flex-col items-center justify-center px-5 py-9 text-center transition"
                    style={{ borderRadius: 16, border: `1px dashed ${dragOver ? "rgba(255,150,100,.8)" : "var(--line2)"}`, background: dragOver ? "rgba(255,138,76,.1)" : "rgba(0,0,0,.35)" }}>
                    <span className="ico" style={{ width: 46, height: 46 }}><Upload className="h-5 w-5" /></span>
                    <p className="mt-3 break-all text-[14px] font-semibold">{ragFile ? ragFile.name : <>Drop a file or <span style={{ color: "var(--ember2)" }}>browse</span></>}</p>
                    <small className="tiny mt-1.5">.pdf · .md · .txt · .csv</small>
                  </div>
                </div>
                {adminAlert && <ErrorMessage>{adminAlert}</ErrorMessage>}
              </div>
              <div className="flex flex-col-reverse justify-between gap-2 border-t border-[var(--line)] bg-black/20 px-6 py-4 sm:flex-row">
                <button type="button" onClick={closeAdmin} className="btn btn-ghost">Close</button>
                <button type="button" disabled={adminBusy} onClick={submitRagUpload} className="btn btn-primary">{adminBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{adminBusy ? "Uploading & indexing…" : "Upload & update RAG"}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------------- Toasts ---------------- */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[120] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2" aria-live="polite" aria-atomic="false">
        <AnimatePresence initial={false}>
          {toasts.map((item) => (
            <motion.div key={item.id} initial={{ opacity: 0, x: 24, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 18, scale: 0.97 }} transition={{ duration: 0.28, ease: [0.2, 0.7, 0.2, 1] }}
              className="gl pointer-events-auto flex items-start gap-3 px-4 py-3.5" style={{ borderRadius: 14, background: item.error ? "linear-gradient(160deg, rgba(70,26,26,.88), rgba(30,14,14,.9))" : "linear-gradient(160deg, rgba(34,36,44,.9), rgba(16,17,22,.92))", borderColor: item.error ? "rgba(255,141,141,.4)" : "var(--line2)" }}>
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ background: item.error ? "rgba(255,141,141,.18)" : "rgba(123,224,164,.18)", color: item.error ? "var(--bad)" : "var(--ok)" }}>{item.error ? <AlertTriangle className="h-3 w-3" /> : <Check className="h-3 w-3" />}</span>
              <span className="min-w-0 flex-1 text-[13px] leading-5">{item.message}</span>
              <button type="button" aria-label="Dismiss notification" onClick={() => setToasts((current) => current.filter((toast) => toast.id !== item.id))} className="icon-btn" style={{ width: 24, height: 24, borderRadius: 7, marginRight: -4 }}><X className="h-3.5 w-3.5" /></button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
