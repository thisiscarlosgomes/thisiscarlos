"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type VoiceNoteItem = {
  id: string;
  summary: string;
  transcript: string;
  durationSeconds: number;
  createdAt: string;
};

type BeliefItem = {
  id: string;
  topic: string;
  statement: string;
  confidence: number;
  confidenceReason?: string | null;
  status: "active" | "superseded" | "draft";
  sourceType: "voice_note" | "call_log" | "manual";
  sourceId: string;
  evidenceCount: number;
  sourceEvidenceCount?: number;
  externalEvidenceCount?: number;
  supportScore?: number;
  challengeScore?: number;
  conflict?: boolean;
  conflictsWithBeliefId?: string | null;
  changeReason?: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  supersedesBeliefId: string | null;
  createdAt: string;
  updatedAt: string;
};

type EvidenceItem = {
  id: string;
  beliefId: string | null;
  url: string;
  domain: string;
  title: string | null;
  summary: string;
  excerpt: string;
  stance: "supports" | "challenges" | "neutral";
  qualityScore: number;
  fetchedAt: string;
  createdAt: string;
  updatedAt: string;
};

type ThinkingTimelineItem = {
  id: string;
  topic: string;
  statement: string;
  status: "active" | "superseded" | "draft";
  confidence: number;
  conflict: boolean;
  conflictsWithBeliefId: string | null;
  supersedesBeliefId: string | null;
  changeReason: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  updatedAt: string;
};

type WeeklyDigest = {
  windowDays: number;
  generatedAt: string;
  changedTopics: number;
  openConflicts: number;
  promotedBeliefs: number;
  items: Array<{
    topic: string;
    currentView: string | null;
    previousView: string | null;
    conflictOpen: boolean;
    changedAt: string;
  }>;
};

type ToolMetricSummary = {
  windowHours: number;
  generatedAt: string;
  tools: Array<{
    tool: string;
    total: number;
    successCount: number;
    successRate: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
  }>;
};

type MemoryQualityReport = {
  windowDays: number;
  generatedAt: string;
  memoryHitRate: number;
  avgMemoryFit: number;
  lowFitRate: number;
  staleBeliefRate: number;
  contradictionRate: number;
  toolLatencyP95Ms: number;
  autoReviewQueue: Array<{
    type: "conflict" | "stale";
    topic: string;
    score: number;
  }>;
};

type EvolutionEvent = {
  beliefId: string;
  topic: string;
  eventType: "created" | "updated" | "approved" | "activated" | "superseded" | "archived" | "merged" | "conflict_detected";
  status: "active" | "superseded" | "draft";
  confidence: number;
  statement: string;
  reason: string | null;
  previousBeliefId: string | null;
  createdAt: string;
};

const MAX_RECORD_SECONDS = 60;

function formatTimeAgo(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "recently";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSeconds < 5) return "just now";
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export default function VoiceNotesPage() {
  const [notes, setNotes] = useState<VoiceNoteItem[]>([]);
  const [beliefs, setBeliefs] = useState<BeliefItem[]>([]);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [beliefsLoading, setBeliefsLoading] = useState(true);
  const [evidenceLoading, setEvidenceLoading] = useState(true);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [digestLoading, setDigestLoading] = useState(true);
  const [toolMetricsLoading, setToolMetricsLoading] = useState(true);
  const [qualityLoading, setQualityLoading] = useState(true);
  const [evolutionLoading, setEvolutionLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [beliefsError, setBeliefsError] = useState("");
  const [evidenceError, setEvidenceError] = useState("");
  const [timelineError, setTimelineError] = useState("");
  const [digestError, setDigestError] = useState("");
  const [toolMetricsError, setToolMetricsError] = useState("");
  const [qualityError, setQualityError] = useState("");
  const [evolutionError, setEvolutionError] = useState("");
  const [beliefAction, setBeliefAction] = useState("");
  const [evidenceAction, setEvidenceAction] = useState("");
  const [evidenceDraftByBelief, setEvidenceDraftByBelief] = useState<Record<string, string>>({});
  const [timeline, setTimeline] = useState<ThinkingTimelineItem[]>([]);
  const [digest, setDigest] = useState<WeeklyDigest | null>(null);
  const [toolMetrics, setToolMetrics] = useState<ToolMetricSummary | null>(null);
  const [qualityReport, setQualityReport] = useState<MemoryQualityReport | null>(null);
  const [evolutionEvents, setEvolutionEvents] = useState<EvolutionEvent[]>([]);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editTranscriptById, setEditTranscriptById] = useState<Record<string, string>>({});
  const [savingNoteId, setSavingNoteId] = useState<string>("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const previewUrl = useMemo(() => (recordedBlob ? URL.createObjectURL(recordedBlob) : ""), [recordedBlob]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function loadNotes() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/voice-notes/list", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = "/lg";
          return;
        }
        throw new Error("Could not load notes");
      }
      const data = (await response.json()) as { notes: VoiceNoteItem[] };
      setNotes(data.notes ?? []);
    } catch (loadError) {
      console.error(loadError);
      setError("Could not load voice notes.");
    } finally {
      setLoading(false);
    }
  }

  async function loadBeliefs() {
    setBeliefsLoading(true);
    setBeliefsError("");
    try {
      const response = await fetch("/api/thinking/review?status=active,draft,superseded&limit=100", {
        cache: "no-store",
      });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = "/lg";
          return;
        }
        throw new Error("Could not load beliefs");
      }
      const data = (await response.json()) as { beliefs?: BeliefItem[] };
      setBeliefs(data.beliefs ?? []);
    } catch (loadError) {
      console.error(loadError);
      setBeliefsError("Could not load beliefs.");
    } finally {
      setBeliefsLoading(false);
    }
  }

  async function loadEvidence() {
    setEvidenceLoading(true);
    setEvidenceError("");
    try {
      const response = await fetch("/api/evidence/list?limit=400", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = "/lg";
          return;
        }
        throw new Error("Could not load evidence");
      }
      const data = (await response.json()) as { evidence?: EvidenceItem[] };
      setEvidence(data.evidence ?? []);
    } catch (loadError) {
      console.error(loadError);
      setEvidenceError("Could not load evidence.");
    } finally {
      setEvidenceLoading(false);
    }
  }

  async function loadTimeline() {
    setTimelineLoading(true);
    setTimelineError("");
    try {
      const response = await fetch("/api/thinking/timeline?limit=40", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = "/lg";
          return;
        }
        throw new Error("Could not load thinking timeline");
      }
      const data = (await response.json()) as { timeline?: ThinkingTimelineItem[] };
      setTimeline(data.timeline ?? []);
    } catch (loadError) {
      console.error(loadError);
      setTimelineError("Could not load thinking timeline.");
    } finally {
      setTimelineLoading(false);
    }
  }

  async function loadDigest() {
    setDigestLoading(true);
    setDigestError("");
    try {
      const response = await fetch("/api/thinking/weekly-digest", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = "/lg";
          return;
        }
        throw new Error("Could not load weekly digest");
      }
      const data = (await response.json()) as { digest?: WeeklyDigest };
      setDigest(data.digest ?? null);
    } catch (loadError) {
      console.error(loadError);
      setDigestError("Could not load weekly digest.");
    } finally {
      setDigestLoading(false);
    }
  }

  async function loadToolMetrics() {
    setToolMetricsLoading(true);
    setToolMetricsError("");
    try {
      const response = await fetch("/api/tools/metrics?hours=24", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = "/lg";
          return;
        }
        throw new Error("Could not load tool metrics");
      }
      const data = (await response.json()) as ToolMetricSummary;
      setToolMetrics(data);
    } catch (loadError) {
      console.error(loadError);
      setToolMetricsError("Could not load tool metrics.");
    } finally {
      setToolMetricsLoading(false);
    }
  }

  async function loadQualityReport() {
    setQualityLoading(true);
    setQualityError("");
    try {
      const response = await fetch("/api/thinking/quality?days=7", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = "/lg";
          return;
        }
        throw new Error("Could not load memory quality");
      }
      const data = (await response.json()) as { report?: MemoryQualityReport };
      setQualityReport(data.report ?? null);
    } catch (loadError) {
      console.error(loadError);
      setQualityError("Could not load memory quality.");
    } finally {
      setQualityLoading(false);
    }
  }

  async function loadEvolution() {
    setEvolutionLoading(true);
    setEvolutionError("");
    try {
      const response = await fetch("/api/thinking/evolution?days=30&limit=60", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = "/lg";
          return;
        }
        throw new Error("Could not load evolution timeline");
      }
      const data = (await response.json()) as { evolution?: EvolutionEvent[] };
      setEvolutionEvents(data.evolution ?? []);
    } catch (loadError) {
      console.error(loadError);
      setEvolutionError("Could not load evolution timeline.");
    } finally {
      setEvolutionLoading(false);
    }
  }

  useEffect(() => {
    void loadNotes();
    void loadBeliefs();
    void loadEvidence();
    void loadTimeline();
    void loadDigest();
    void loadToolMetrics();
    void loadQualityReport();
    void loadEvolution();
  }, []);

  function clearTimer() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  async function startRecording() {
    setError("");
    setRecordedBlob(null);
    setRecordedSeconds(0);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mediaRecorder = new MediaRecorder(stream);
    mediaRecorderRef.current = mediaRecorder;
    chunksRef.current = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType || "audio/webm" });
      setRecordedBlob(blob);
      stream.getTracks().forEach((track) => track.stop());
      clearTimer();
      setRecording(false);
    };

    mediaRecorder.start();
    setRecording(true);
    timerRef.current = window.setInterval(() => {
      setRecordedSeconds((value) => {
        const next = value + 1;
        if (next >= MAX_RECORD_SECONDS) {
          const recorder = mediaRecorderRef.current;
          if (recorder && recorder.state === "recording") {
            recorder.stop();
          }
          return MAX_RECORD_SECONDS;
        }
        return next;
      });
    }, 1000);
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    recorder.stop();
  }

  async function uploadBlob(blob: Blob, seconds: number) {
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", blob, `voice-note-${Date.now()}.webm`);
      form.set("duration_seconds", String(seconds));
      const response = await fetch("/api/voice-notes/upload", {
        method: "POST",
        body: form,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({ error: "Upload failed" }))) as { error?: string };
        throw new Error(body.error ?? "Upload failed");
      }

      setRecordedBlob(null);
      setRecordedSeconds(0);
      await loadNotes();
      await loadBeliefs();
      await loadEvidence();
      await loadTimeline();
      await loadDigest();
      await loadToolMetrics();
      await loadQualityReport();
      await loadEvolution();
    } catch (uploadError) {
      console.error(uploadError);
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function onUploadRecorded() {
    if (!recordedBlob) return;
    await uploadBlob(recordedBlob, recordedSeconds);
  }

  async function onFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await uploadBlob(file, 0);
    event.target.value = "";
  }

  async function signOut() {
    await fetch("/api/voice-notes/auth", { method: "DELETE" });
    window.location.href = "/lg";
  }

  function startEditNote(note: VoiceNoteItem) {
    setEditingNoteId(note.id);
    setEditTranscriptById((prev) => ({ ...prev, [note.id]: note.transcript }));
    setError("");
  }

  function cancelEditNote() {
    setEditingNoteId(null);
  }

  async function saveEditedNote(noteId: string) {
    const transcript = String(editTranscriptById[noteId] ?? "").trim();
    if (!transcript) {
      setError("Transcript cannot be empty.");
      return;
    }

    setSavingNoteId(noteId);
    setError("");
    try {
      const response = await fetch("/api/voice-notes/update", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId, transcript }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({ error: "Could not save note" }))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Could not save note");
      }

      const data = (await response.json()) as { note?: VoiceNoteItem };
      if (data.note) {
        setNotes((prev) => prev.map((item) => (item.id === noteId ? data.note! : item)));
      } else {
        await loadNotes();
      }
      await loadBeliefs();
      await loadTimeline();
      await loadDigest();
      await loadQualityReport();
      await loadEvolution();
      setEditingNoteId(null);
    } catch (saveError) {
      console.error(saveError);
      setError(saveError instanceof Error ? saveError.message : "Could not save note");
    } finally {
      setSavingNoteId("");
    }
  }

  async function runBeliefAction(action: string, beliefId: string, targetBeliefId?: string) {
    setBeliefAction(`${action}:${beliefId}`);
    setBeliefsError("");
    try {
      const response = await fetch("/api/thinking/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, beliefId, ...(targetBeliefId ? { targetBeliefId } : {}) }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({ error: "Action failed" }))) as { error?: string };
        throw new Error(body.error ?? "Action failed");
      }
      await loadBeliefs();
      await loadEvidence();
      await loadTimeline();
      await loadDigest();
      await loadToolMetrics();
      await loadQualityReport();
      await loadEvolution();
    } catch (actionError) {
      console.error(actionError);
      setBeliefsError(actionError instanceof Error ? actionError.message : "Action failed");
    } finally {
      setBeliefAction("");
    }
  }

  async function addEvidence(beliefId: string) {
    const url = String(evidenceDraftByBelief[beliefId] ?? "").trim();
    if (!url) return;

    setEvidenceAction(`ingest:${beliefId}`);
    setEvidenceError("");
    try {
      const response = await fetch("/api/evidence/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, beliefId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({ error: "Could not add evidence" }))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Could not add evidence");
      }

      setEvidenceDraftByBelief((prev) => ({ ...prev, [beliefId]: "" }));
      await loadBeliefs();
      await loadEvidence();
      await loadTimeline();
      await loadDigest();
      await loadToolMetrics();
      await loadQualityReport();
      await loadEvolution();
    } catch (actionError) {
      console.error(actionError);
      setEvidenceError(actionError instanceof Error ? actionError.message : "Could not add evidence");
    } finally {
      setEvidenceAction("");
    }
  }

  const latestActiveByTopic = beliefs.reduce<Record<string, BeliefItem>>((acc, belief) => {
    if (belief.status !== "active") return acc;
    const existing = acc[belief.topic];
    if (!existing || new Date(belief.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
      acc[belief.topic] = belief;
    }
    return acc;
  }, {});

  const evidenceByBelief = evidence.reduce<Record<string, EvidenceItem[]>>((acc, row) => {
    if (!row.beliefId) return acc;
    if (!acc[row.beliefId]) acc[row.beliefId] = [];
    acc[row.beliefId].push(row);
    return acc;
  }, {});

  const conflictCount = beliefs.filter((belief) => belief.status === "draft" && belief.conflict).length;

  const prioritizedBeliefs = [...beliefs].sort((a, b) => {
    const aConflict = a.status === "draft" && a.conflict ? 1 : 0;
    const bConflict = b.status === "draft" && b.conflict ? 1 : 0;
    if (aConflict !== bConflict) return bConflict - aConflict;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-6 pb-20 pt-8 sm:px-8">
      <header className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-zinc-900">Voice Notes</h1>
          <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-[11px] font-semibold text-zinc-600">
            conflicts: {conflictCount}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/"
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-700"
          >
            Back Home
          </Link>
          <button
            type="button"
            onClick={signOut}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-700"
          >
            Sign out
          </button>
        </div>
      </header>

      <section className="rounded-3xl border border-zinc-200 bg-zinc-50 p-6">
        <p className="text-center text-sm text-zinc-600">
          {recording ? "Recording…" : "Tap to record a new note"}
        </p>
        <p className="mt-1 text-center text-xs text-zinc-500">{formatDuration(recordedSeconds)}</p>

        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            className={`h-20 w-20 rounded-full border-4 transition ${
              recording ? "border-red-200 bg-red-500" : "border-red-100 bg-red-600"
            }`}
            aria-label={recording ? "Stop recording" : "Start recording"}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onUploadRecorded}
            disabled={!recordedBlob || uploading}
            className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {uploading ? "Processing..." : "Save Recording"}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900"
          >
            Upload Audio File
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={onFileSelected}
            className="hidden"
          />
        </div>

        {previewUrl ? <audio className="mt-3 w-full" controls src={previewUrl} /> : null}
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="text-sm font-semibold text-zinc-900">weekly digest</h2>
        {digestLoading ? (
          <div className="h-24 animate-pulse rounded-2xl bg-zinc-100" />
        ) : !digest ? (
          <p className="text-sm text-zinc-600">no digest yet.</p>
        ) : (
          <div className="rounded-2xl border border-zinc-200 bg-white p-4">
            <p className="text-xs text-zinc-500">
              last update {formatTimeAgo(digest.generatedAt)} · {digest.windowDays}d window
            </p>
            <p className="mt-1 text-sm text-zinc-700">
              {digest.changedTopics} changed topics · {digest.openConflicts} open conflicts ·{" "}
              {digest.promotedBeliefs} promoted beliefs
            </p>
            <div className="mt-3 space-y-2">
              {digest.items.slice(0, 5).map((item) => (
                <div key={`${item.topic}:${item.changedAt}`} className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-zinc-900">{item.topic}</p>
                    <p className="text-[11px] text-zinc-500">{formatTimeAgo(item.changedAt)}</p>
                  </div>
                  <p className="mt-1 text-xs text-zinc-700">{item.currentView || "no active view yet."}</p>
                  {item.conflictOpen ? <p className="mt-1 text-[11px] text-amber-700">conflict needs review</p> : null}
                </div>
              ))}
            </div>
          </div>
        )}
        {digestError ? <p className="text-sm text-red-600">{digestError}</p> : null}
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="text-sm font-semibold text-zinc-900">thinking timeline</h2>
        {timelineLoading ? (
          <div className="space-y-2">
            <div className="h-16 animate-pulse rounded-2xl bg-zinc-100" />
            <div className="h-16 animate-pulse rounded-2xl bg-zinc-100" />
          </div>
        ) : timeline.length === 0 ? (
          <p className="text-sm text-zinc-600">no timeline entries yet.</p>
        ) : (
          <div className="space-y-2">
            {timeline.slice(-12).reverse().map((item) => (
              <article key={item.id} className="rounded-2xl border border-zinc-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-zinc-900">{item.topic}</p>
                  <p className="text-[11px] text-zinc-500">{item.status}</p>
                </div>
                <p className="mt-1 text-xs text-zinc-700">{item.statement}</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {Math.round(item.confidence * 100)}% · {formatTimeAgo(item.updatedAt)}
                </p>
                {item.changeReason ? <p className="mt-1 text-[11px] text-zinc-500">{item.changeReason}</p> : null}
                {item.conflict ? <p className="mt-1 text-[11px] text-amber-700">conflict candidate</p> : null}
              </article>
            ))}
          </div>
        )}
        {timelineError ? <p className="text-sm text-red-600">{timelineError}</p> : null}
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="text-sm font-semibold text-zinc-900">tool health (24h)</h2>
        {toolMetricsLoading ? (
          <div className="h-20 animate-pulse rounded-2xl bg-zinc-100" />
        ) : !toolMetrics ? (
          <p className="text-sm text-zinc-600">no tool data yet.</p>
        ) : (
          <div className="space-y-2">
            {toolMetrics.tools.map((row) => (
              <article key={row.tool} className="rounded-2xl border border-zinc-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-zinc-900">{row.tool}</p>
                  <p className="text-[11px] text-zinc-500">{row.total} calls</p>
                </div>
                <p className="mt-1 text-xs text-zinc-700">
                  success {Math.round(row.successRate * 100)}% · avg {row.avgLatencyMs}ms · p95 {row.p95LatencyMs}
                  ms
                </p>
              </article>
            ))}
          </div>
        )}
        {toolMetricsError ? <p className="text-sm text-red-600">{toolMetricsError}</p> : null}
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="text-sm font-semibold text-zinc-900">memory quality (7d)</h2>
        {qualityLoading ? (
          <div className="h-20 animate-pulse rounded-2xl bg-zinc-100" />
        ) : !qualityReport ? (
          <p className="text-sm text-zinc-600">no quality data yet.</p>
        ) : (
          <div className="rounded-2xl border border-zinc-200 bg-white p-3">
            <p className="text-xs text-zinc-500">updated {formatTimeAgo(qualityReport.generatedAt)}</p>
            <p className="mt-1 text-xs text-zinc-700">
              hit rate {Math.round(qualityReport.memoryHitRate * 100)}% · avg fit{" "}
              {Math.round(qualityReport.avgMemoryFit * 100)}% · low fit{" "}
              {Math.round(qualityReport.lowFitRate * 100)}%
            </p>
            <p className="mt-1 text-xs text-zinc-700">
              stale {Math.round(qualityReport.staleBeliefRate * 100)}% · contradictions{" "}
              {Math.round(qualityReport.contradictionRate * 100)}% · tool p95 {qualityReport.toolLatencyP95Ms}ms
            </p>
            {qualityReport.autoReviewQueue.length > 0 ? (
              <div className="mt-2 space-y-1">
                {qualityReport.autoReviewQueue.slice(0, 5).map((item, index) => (
                  <p key={`${item.type}:${item.topic}:${index}`} className="text-xs text-zinc-600">
                    {item.type}: {item.topic} ({Math.round(item.score * 100)}%)
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        )}
        {qualityError ? <p className="text-sm text-red-600">{qualityError}</p> : null}
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="text-sm font-semibold text-zinc-900">evolution timeline (30d)</h2>
        {evolutionLoading ? (
          <div className="space-y-2">
            <div className="h-14 animate-pulse rounded-2xl bg-zinc-100" />
            <div className="h-14 animate-pulse rounded-2xl bg-zinc-100" />
          </div>
        ) : evolutionEvents.length === 0 ? (
          <p className="text-sm text-zinc-600">no evolution events yet.</p>
        ) : (
          <div className="space-y-2">
            {evolutionEvents.slice(0, 10).map((event, idx) => (
              <article key={`${event.beliefId}-${event.createdAt}-${idx}`} className="rounded-2xl border border-zinc-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-zinc-900">{event.topic}</p>
                  <p className="text-[11px] text-zinc-500">{event.eventType}</p>
                </div>
                <p className="mt-1 text-xs text-zinc-700">{event.statement}</p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  confidence {Math.round(event.confidence * 100)}% · {formatTimeAgo(event.createdAt)}
                </p>
                {event.reason ? <p className="mt-1 text-[11px] text-zinc-500">{event.reason}</p> : null}
              </article>
            ))}
          </div>
        )}
        {evolutionError ? <p className="text-sm text-red-600">{evolutionError}</p> : null}
      </section>

      <section className="mt-6 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">belief review</h2>
          <button
            type="button"
            onClick={() => {
              void loadBeliefs();
              void loadEvidence();
              void loadTimeline();
              void loadDigest();
              void loadToolMetrics();
              void loadQualityReport();
              void loadEvolution();
            }}
            disabled={
              beliefsLoading ||
              evidenceLoading ||
              timelineLoading ||
              digestLoading ||
              toolMetricsLoading ||
              qualityLoading ||
              evolutionLoading
            }
            className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 disabled:opacity-60"
          >
            refresh
          </button>
        </div>
        {beliefsLoading ? (
          <div className="space-y-2">
            <div className="h-20 animate-pulse rounded-2xl bg-zinc-100" />
            <div className="h-20 animate-pulse rounded-2xl bg-zinc-100" />
          </div>
        ) : beliefs.length === 0 ? (
          <p className="text-sm text-zinc-600">no beliefs yet.</p>
        ) : (
          prioritizedBeliefs.map((belief) => {
            const latestActiveForTopic = latestActiveByTopic[belief.topic];
            const mergeTarget =
              latestActiveForTopic && latestActiveForTopic.id !== belief.id ? latestActiveForTopic : null;
            const actionKey = (action: string) => `${action}:${belief.id}`;
            const rows = evidenceByBelief[belief.id] ?? [];

            return (
              <article key={belief.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-900">{belief.topic}</p>
                  <span className="text-xs text-zinc-500">{belief.status}</span>
                </div>
                <p className="mt-1 text-sm text-zinc-700">{belief.statement}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  confidence: {Math.round(belief.confidence * 100)}% · sources:{" "}
                  {Math.max(1, Number(belief.sourceEvidenceCount ?? 1))} · links:{" "}
                  {Math.max(0, Number(belief.externalEvidenceCount ?? belief.evidenceCount ?? 0))} · source:{" "}
                  {belief.sourceType}
                </p>
                {belief.confidenceReason ? (
                  <p className="mt-1 text-xs text-zinc-500">{belief.confidenceReason}</p>
                ) : null}
                {belief.changeReason ? <p className="mt-1 text-xs text-zinc-500">{belief.changeReason}</p> : null}
                {belief.conflict ? (
                  <p className="mt-1 text-xs font-semibold text-amber-700">conflict detected: review needed</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {belief.status === "draft" ? (
                    <button
                      type="button"
                      onClick={() => void runBeliefAction("approve_draft", belief.id)}
                      disabled={beliefAction === actionKey("approve_draft")}
                      className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      approve
                    </button>
                  ) : null}
                  {belief.status === "active" ? (
                    <button
                      type="button"
                      onClick={() => void runBeliefAction("supersede_active", belief.id)}
                      disabled={beliefAction === actionKey("supersede_active")}
                      className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 disabled:opacity-60"
                    >
                      supersede
                    </button>
                  ) : null}
                  {belief.status === "superseded" ? (
                    <button
                      type="button"
                      onClick={() => void runBeliefAction("activate_belief", belief.id)}
                      disabled={beliefAction === actionKey("activate_belief")}
                      className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      active
                    </button>
                  ) : null}
                  {mergeTarget ? (
                    <button
                      type="button"
                      onClick={() => void runBeliefAction("merge_into_active", belief.id, mergeTarget.id)}
                      disabled={beliefAction === actionKey("merge_into_active")}
                      className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 disabled:opacity-60"
                    >
                      merge to active
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void runBeliefAction("archive_belief", belief.id)}
                    disabled={beliefAction === actionKey("archive_belief")}
                    className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs font-semibold text-zinc-700 disabled:opacity-60"
                  >
                    archive
                  </button>
                </div>

                <div className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                  <p className="text-xs font-semibold text-zinc-700">evidence links</p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      type="url"
                      value={evidenceDraftByBelief[belief.id] ?? ""}
                      onChange={(event) =>
                        setEvidenceDraftByBelief((prev) => ({
                          ...prev,
                          [belief.id]: event.target.value,
                        }))
                      }
                      placeholder="https://..."
                      className="block w-full rounded-xl border border-zinc-300 px-3 py-2 text-xs text-zinc-900 outline-none ring-zinc-900 focus:ring-2"
                    />
                    <button
                      type="button"
                      onClick={() => void addEvidence(belief.id)}
                      disabled={evidenceAction === `ingest:${belief.id}`}
                      className="rounded-full bg-zinc-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                    >
                      {evidenceAction === `ingest:${belief.id}` ? "adding..." : "add link"}
                    </button>
                  </div>
                  {evidenceLoading ? (
                    <div className="mt-2 h-8 animate-pulse rounded bg-zinc-100" />
                  ) : rows.length === 0 ? (
                    <p className="mt-2 text-xs text-zinc-500">no external links yet.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {rows.slice(0, 5).map((row) => (
                        <div key={row.id} className="rounded-lg border border-zinc-200 bg-white p-2">
                          <div className="flex items-center justify-between gap-2">
                            <a
                              href={row.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate text-xs font-semibold text-zinc-900 underline underline-offset-2"
                            >
                              {row.title || row.domain}
                            </a>
                            <span className="text-[11px] text-zinc-500">
                              {row.stance} · q{Math.round(row.qualityScore * 100)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-zinc-600">{row.summary}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })
        )}
        {beliefsError ? <p className="text-sm text-red-600">{beliefsError}</p> : null}
        {evidenceError ? <p className="text-sm text-red-600">{evidenceError}</p> : null}
      </section>

      <section className="mt-6 space-y-2">
        <h2 className="text-sm font-semibold text-zinc-900">Recent Voice Notes</h2>
        {loading ? (
          <div className="space-y-2">
            <div className="h-20 animate-pulse rounded-2xl bg-zinc-100" />
            <div className="h-20 animate-pulse rounded-2xl bg-zinc-100" />
          </div>
        ) : notes.length === 0 ? (
          <p className="text-sm text-zinc-600">No notes yet.</p>
        ) : (
          notes.map((note) => (
            <article key={note.id} className="rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-zinc-900">{note.summary}</p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500">{formatTimeAgo(note.createdAt)}</span>
                  {editingNoteId === note.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          void saveEditedNote(note.id);
                        }}
                        disabled={savingNoteId === note.id}
                        className="text-xs font-semibold underline text-zinc-700 disabled:opacity-60"
                      >
                        {savingNoteId === note.id ? "saving..." : "save"}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditNote}
                        disabled={savingNoteId === note.id}
                        className="text-xs underline text-zinc-500 disabled:opacity-60"
                      >
                        cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditNote(note)}
                      className="text-xs underline text-zinc-500 hover:text-zinc-700"
                    >
                      edit
                    </button>
                  )}
                </div>
              </div>
              {editingNoteId === note.id ? (
                <textarea
                  value={editTranscriptById[note.id] ?? ""}
                  onChange={(event) =>
                    setEditTranscriptById((prev) => ({
                      ...prev,
                      [note.id]: event.target.value,
                    }))
                  }
                  rows={8}
                  className="mt-2 block w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm text-zinc-800 outline-none ring-zinc-900 focus:ring-2"
                />
              ) : (
                <p className="mt-2 text-sm text-zinc-700">{note.transcript}</p>
              )}
              <p className="mt-2 text-xs text-zinc-500">Length: {formatDuration(note.durationSeconds)}</p>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
