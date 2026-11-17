import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardPaste,
  Download,
  Edit3,
  FileVideo,
  Link2,
  Loader2,
  RefreshCw,
  Sparkles,
  Subtitles,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type {
  AspectRatio,
  CaptionStyle,
  ClipDTO,
  ContentStyle,
  ExportResolution,
  JobProgress,
  ProjectConfig,
  ProjectDTO,
  StudioSample,
  VideoTheme,
  YouTubeInspectResult,
} from '../shared/types';
import { downloadClipMp4 } from '../utils/downloadClip';
import { CAPTION_STYLES, VIDEO_THEMES, getVideoThemeMeta, normalizeVideoTheme } from '../utils/videoStyles';
import { buildYouTubeEmbedUrl, formatFileSize, formatTimecode, parseYouTubeUrl } from '../utils/youtube';
import { FancyCaptionOverlay } from './FancyCaptionOverlay';

interface AnalyzerViewProps {
  initialProjectId?: number | null;
  refreshKey?: number;
  initialYoutubeUrl?: string;
  initialTemplateConfig?: Partial<ProjectConfig> | null;
  onClearInitialUrl: () => void;
  onEditClip: (clip: ClipDTO, project: ProjectDTO) => void;
  onProjectLoaded: (project: ProjectDTO) => void;
}

const DEFAULT_CONFIG: ProjectConfig = {
  clipCount: 3,
  clipDuration: 30,
  aspectRatio: '9:16',
  captionStyle: 'Modern',
  videoTheme: 'Original',
  contentStyle: 'Podcast',
  enhanceAudio: true,
  trimSilence: false,
  bgMusic: false,
  includeIntroOutro: false,
  resolution: '1080p',
};

const PIPELINE_STEPS: Array<{ key: JobProgress['stage']; label: string }> = [
  { key: 'acquiring_media', label: 'Media Acquisition' },
  { key: 'extracting_audio', label: 'Audio Extraction' },
  { key: 'transcribing', label: 'Speech-to-Text' },
  { key: 'analyzing_moments', label: 'AI Moment Detection' },
  { key: 'rendering_clips', label: 'FFmpeg Rendering' },
];

export function AnalyzerView({
  initialProjectId,
  refreshKey = 0,
  initialYoutubeUrl,
  initialTemplateConfig,
  onClearInitialUrl,
  onEditClip,
  onProjectLoaded,
}: AnalyzerViewProps) {
  const { authFetch, getValidToken, token, refreshProfile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachFileRef = useRef<HTMLInputElement | null>(null);

  const [youtubeUrl, setYoutubeUrl] = useState(initialYoutubeUrl || '');
  const [inspectResult, setInspectResult] = useState<YouTubeInspectResult | null>(null);
  const [inspecting, setInspecting] = useState(false);

  const [directMp4Url, setDirectMp4Url] = useState('');
  const [showDirectUrlInput, setShowDirectUrlInput] = useState(false);

  const [samples, setSamples] = useState<StudioSample[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectDTO | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [config, setConfig] = useState<ProjectConfig>({
    ...DEFAULT_CONFIG,
    ...(initialTemplateConfig || {}),
  });

  const [customClipCount, setCustomClipCount] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ percent: number; loaded: number; total: number } | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState('');
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);
  const [downloadingClipId, setDownloadingClipId] = useState<number | null>(null);
  const [expandedScores, setExpandedScores] = useState<Record<number, boolean>>({});
  const [transcriptQuery, setTranscriptQuery] = useState('');

  // Load studio samples
  useEffect(() => {
    fetch('/api/samples')
      .then((r) => r.json())
      .then((data: { samples: StudioSample[] }) => setSamples(data.samples || []))
      .catch(() => {});
  }, []);

  // Apply template updates when user chooses one
  useEffect(() => {
    if (initialTemplateConfig) {
      setConfig((prev) => ({ ...prev, ...initialTemplateConfig }));
    }
  }, [initialTemplateConfig]);

  // Load existing project if selected from Dashboard or My Projects
  useEffect(() => {
    if (!initialProjectId) return;
    let active = true;
    setError('');
    authFetch(`/api/projects/${initialProjectId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Could not open project.');
        return (await res.json()) as { project: ProjectDTO; progress: JobProgress | null };
      })
      .then((data) => {
        if (!active) return;
        setActiveProject(data.project);
        setConfig(data.project.config);
        setProgress(data.progress);
        onProjectLoaded(data.project);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load project.');
      });
    return () => {
      active = false;
    };
  }, [initialProjectId, refreshKey, authFetch, onProjectLoaded]);

  // Auto-inspect if redirected from Landing / Dashboard with a YouTube URL
  useEffect(() => {
    if (!initialYoutubeUrl) return;
    setYoutubeUrl(initialYoutubeUrl);
    void inspectYouTubeLink(initialYoutubeUrl);
    onClearInitialUrl();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialYoutubeUrl]);

  // Poll active background processing job
  const activeProjectId = activeProject?.id;
  const activeProjectStatus = activeProject?.status;
  useEffect(() => {
    if (
      !activeProjectId ||
      !activeProjectStatus ||
      !['analyzing', 'analyzed', 'generating'].includes(activeProjectStatus)
    ) {
      return;
    }

    const timer = setInterval(() => {
      void authFetch(`/api/projects/${activeProjectId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { project: ProjectDTO; progress: JobProgress | null } | null) => {
          if (!data) return;
          setActiveProject(data.project);
          setProgress(data.progress);
          onProjectLoaded(data.project);
          if (data.project.status === 'completed') {
            void refreshProfile();
          }
        })
        .catch(() => {});
    }, 1500);

    return () => clearInterval(timer);
  }, [activeProjectId, activeProjectStatus, authFetch, onProjectLoaded, refreshProfile]);

  const inspectYouTubeLink = async (rawUrl: string) => {
    const parsed = parseYouTubeUrl(rawUrl);
    if (!parsed.valid) {
      setError(parsed.error || 'Enter a valid YouTube URL.');
      return;
    }

    setError('');
    setInspecting(true);
    try {
      const res = await authFetch('/api/youtube/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to inspect YouTube link.');
      setInspectResult(data as YouTubeInspectResult);

      // Persist YouTube metadata project in PostgreSQL
      const createRes = await authFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: 'youtube',
          sourceUrl: data.canonicalUrl,
          title: data.title,
          channelName: data.channelName,
          thumbnailUrl: data.thumbnailUrl,
          config,
        }),
      });
      const created = await createRes.json();
      if (!createRes.ok) throw new Error(created.error || 'Failed to save project.');
      setActiveProject(created.project);
      onProjectLoaded(created.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to inspect YouTube URL.');
    } finally {
      setInspecting(false);
    }
  };

  const handlePaste = async () => {
    setError('');
    try {
      const text = await navigator.clipboard.readText();
      if (text) setYoutubeUrl(text.trim());
    } catch {
      setYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    }
  };

  const handleUploadFile = async (file: File, attachToProjectId?: number) => {
    const MAX_BYTES = 2 * 1024 * 1024 * 1024;
    if (file.size > MAX_BYTES) {
      setError(`File size (${formatFileSize(file.size)}) exceeds the 2 GB upload limit.`);
      return;
    }

    setError('');
    setUploading(true);
    setUploadProgress({ percent: 0, loaded: 0, total: file.size });
    try {
      const activeToken = await getValidToken();
      const form = new FormData();
      form.append('video', file);
      const endpoint = attachToProjectId
        ? `/api/projects/${attachToProjectId}/attach-source`
        : '/api/upload';

      const data = await new Promise<{ project: ProjectDTO }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', endpoint);
        if (activeToken) {
          xhr.setRequestHeader('Authorization', `Bearer ${activeToken}`);
        }
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable) {
            setUploadProgress({
              percent: Math.min(99, Math.round((evt.loaded / evt.total) * 100)),
              loaded: evt.loaded,
              total: evt.total,
            });
          }
        };
        xhr.onload = () => {
          try {
            const parsed = JSON.parse(xhr.responseText || '{}');
            if (xhr.status >= 200 && xhr.status < 300) {
              setUploadProgress({ percent: 100, loaded: file.size, total: file.size });
              resolve(parsed as { project: ProjectDTO });
            } else {
              reject(new Error(parsed.error || `Upload failed (HTTP ${xhr.status}).`));
            }
          } catch {
            reject(new Error(`Upload failed (HTTP ${xhr.status}).`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error while uploading video file.'));
        xhr.onabort = () => reject(new Error('Upload was cancelled.'));
        xhr.send(form);
      });

      setActiveProject(data.project);
      setInspectResult(null);
      onProjectLoaded(data.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleUseSample = async (sampleId: string, attachToProjectId?: number) => {
    setError('');
    setBusyAction(true);
    try {
      if (attachToProjectId) {
        const res = await authFetch(`/api/projects/${attachToProjectId}/attach-source`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sampleId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not attach sample video.');
        setActiveProject(data.project);
        setInspectResult(null);
        onProjectLoaded(data.project);
      } else {
        const res = await authFetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceType: 'sample',
            sampleId,
            config,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not load sample video.');
        setActiveProject(data.project);
        setInspectResult(null);
        onProjectLoaded(data.project);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to prepare studio sample.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleImportDirectUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directMp4Url.trim()) return;
    setError('');
    setBusyAction(true);
    try {
      const res = await authFetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: 'url',
          sourceUrl: directMp4Url.trim(),
          config,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to import MP4 URL.');
      setActiveProject(data.project);
      setInspectResult(null);
      setShowDirectUrlInput(false);
      onProjectLoaded(data.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import video URL.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleStartPipeline = async () => {
    if (!activeProject) return;
    setError('');
    setBusyAction(true);
    try {
      const res = await authFetch(`/api/projects/${activeProject.id}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start AI analysis.');
      setActiveProject((prev) => (prev ? { ...prev, status: 'analyzing', errorMessage: '' } : prev));
      setProgress(data.progress);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start clipping pipeline.');
    } finally {
      setBusyAction(false);
    }
  };

  const handleRegenerateClip = async (clipId: number) => {
    setRegeneratingId(clipId);
    setError('');
    try {
      const res = await authFetch(`/api/clips/${clipId}/regenerate`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Regeneration failed.');
      setActiveProject((prev) =>
        prev
          ? {
              ...prev,
              clips: (prev.clips || []).map((c) => (c.id === clipId ? data.clip : c)),
            }
          : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not regenerate clip copy.');
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleDownloadClipMp4 = async (clip: ClipDTO) => {
    setError('');
    setDownloadingClipId(clip.id);
    try {
      await downloadClipMp4({
        clipId: clip.id,
        resolution: clip.renderResolution,
        clipTitle: clip.title,
        authFetch,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MP4 download failed.');
    } finally {
      setDownloadingClipId(null);
    }
  };

  const isRunning = Boolean(
    activeProject && ['analyzing', 'analyzed', 'generating'].includes(activeProject.status)
  );
  const filteredTranscript = (activeProject?.transcript || []).filter((seg) =>
    !transcriptQuery.trim()
      ? true
      : seg.text.toLowerCase().includes(transcriptQuery.toLowerCase()) ||
        (seg.speaker || '').toLowerCase().includes(transcriptQuery.toLowerCase())
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-white">
            Video Analyzer &amp; Clip Generator
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Inspect a YouTube URL, upload local video footage, or run an authorized studio sample to extract AI-selected short clips.
          </p>
        </div>
        {activeProject && (
          <button
            type="button"
            onClick={() => {
              setActiveProject(null);
              setInspectResult(null);
              setProgress(null);
              setError('');
            }}
            className="px-3.5 py-2 text-xs font-medium text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg whitespace-nowrap shrink-0 cursor-pointer self-start"
          >
            Start Another Video
          </button>
        )}
      </div>

      {/* Step 1: Source Selector */}
      <section className="p-6 rounded-xl bg-[#111520] border border-white/10 space-y-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void inspectYouTubeLink(youtubeUrl);
          }}
          className="space-y-2.5"
        >
          <label htmlFor="analyzer-youtube-url" className="block text-sm font-medium text-white">
            Step 1. Enter YouTube Video URL
          </label>
          <div className="flex flex-col sm:flex-row gap-2.5 p-2 rounded-lg bg-[#090B10] border border-white/10">
            <input
              id="analyzer-youtube-url"
              type="text"
              value={youtubeUrl}
              onChange={(e) => {
                setYoutubeUrl(e.target.value);
                if (error) setError('');
              }}
              placeholder="Paste youtube.com/watch?v=..., youtu.be/..., or youtube.com/shorts/..."
              className="flex-1 bg-transparent px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none"
            />
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handlePaste}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ClipboardPaste className="w-3.5 h-3.5" aria-hidden="true" />
                Paste Link
              </button>
              <button
                type="submit"
                disabled={inspecting}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-md whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                {inspecting ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="w-4 h-4" aria-hidden="true" />
                )}
                Analyze Video
              </button>
            </div>
          </div>
        </form>

        {/* Direct Upload & Authorized Studio Samples */}
        {!activeProject && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2 border-t border-white/10">
            <div className="lg:col-span-5 space-y-3">
              <p className="text-xs font-medium text-slate-300">
                Or Upload Local Video (MP4, MOV, WebM, MKV up to 2 GB · 3 hours)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.m4v,.mkv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void handleUploadFile(f);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full p-5 rounded-lg border border-dashed border-white/20 hover:border-indigo-400/60 bg-[#090B10] text-center space-y-2 transition-colors cursor-pointer"
              >
                {uploading ? (
                  <Loader2 className="w-6 h-6 text-indigo-400 animate-spin mx-auto" />
                ) : (
                  <Upload className="w-6 h-6 text-slate-400 mx-auto" aria-hidden="true" />
                )}
                <p className="text-sm font-medium text-white">
                  {uploading && uploadProgress
                    ? `Uploading ${uploadProgress.percent}% (${formatFileSize(uploadProgress.loaded)} / ${formatFileSize(uploadProgress.total)})`
                    : uploading
                      ? 'Inspecting video stream...'
                      : 'Choose MP4 / MOV / WebM / MKV file'}
                </p>
                {uploading && uploadProgress && (
                  <div className="h-1.5 w-full max-w-xs mx-auto rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 transition-all duration-150"
                      style={{ width: `${uploadProgress.percent}%` }}
                    />
                  </div>
                )}
                <p className="text-xs text-slate-500">
                  Processed directly on server with FFmpeg and Gemini Multimodal AI
                </p>
              </button>

              <button
                type="button"
                onClick={() => setShowDirectUrlInput((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
              >
                <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                Import from authorized direct MP4 URL
              </button>

              {showDirectUrlInput && (
                <form onSubmit={handleImportDirectUrl} className="flex gap-2">
                  <input
                    type="url"
                    value={directMp4Url}
                    onChange={(e) => setDirectMp4Url(e.target.value)}
                    placeholder="https://example.com/authorized-video.mp4"
                    className="flex-1 px-3 py-1.5 text-xs bg-[#090B10] border border-white/10 rounded-md text-white focus:outline-none focus:border-indigo-500"
                  />
                  <button
                    type="submit"
                    disabled={busyAction}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Import
                  </button>
                </form>
              )}
            </div>

            <div className="lg:col-span-7 space-y-3">
              <p className="text-xs font-medium text-slate-300">
                Authorized Studio Sample Videos (Instant Real FFmpeg + AI Demo)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {samples.map((sample) => (
                  <div
                    key={sample.id}
                    className="rounded-lg bg-[#090B10] border border-white/10 overflow-hidden flex flex-col justify-between"
                  >
                    <div>
                      <img
                        src={sample.thumbnailUrl}
                        alt={sample.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-32 object-cover"
                      />
                      <div className="p-3.5 space-y-1">
                        <p className="text-xs text-slate-400 font-mono tabular-nums">
                          {sample.contentStyle} · {formatTimecode(sample.durationSec)}
                        </p>
                        <h3 className="text-sm font-semibold text-white leading-snug">
                          {sample.title}
                        </h3>
                        <p className="text-xs text-slate-400 line-clamp-2">{sample.description}</p>
                      </div>
                    </div>
                    <div className="px-3.5 pb-3.5">
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => void handleUseSample(sample.id)}
                        className="w-full py-2 text-xs font-semibold text-white bg-white/10 hover:bg-indigo-600 rounded-md transition-colors cursor-pointer disabled:opacity-60"
                      >
                        {busyAction ? 'Preparing Sample...' : 'Load Studio Sample'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 flex items-start gap-3 text-sm text-rose-200">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Active Project Card + YouTube Permission Gate */}
      {activeProject && (
        <section className="p-6 rounded-xl bg-[#111520] border border-white/10 space-y-6">
          <div className="flex flex-col md:flex-row gap-5 items-start">
            <img
              src={activeProject.thumbnailUrl || '/src/assets/images/hero_studio_preview_1794825184394.jpg'}
              alt={activeProject.title}
              referrerPolicy="no-referrer"
              className="w-full md:w-64 h-36 rounded-lg object-cover border border-white/10 shrink-0"
            />
            <div className="flex-1 space-y-2 min-w-0">
              <p className="text-xs text-slate-400 font-mono tabular-nums">
                {activeProject.channelName || 'Creator Channel'} ·{' '}
                {activeProject.durationSec > 0
                  ? formatTimecode(activeProject.durationSec)
                  : 'Metadata retrieved'}
                {inspectResult ? ` · YouTube ${inspectResult.urlType}` : ''}
              </p>
              <h2 className="font-display text-xl font-bold text-white">
                {activeProject.title}
              </h2>

              {!activeProject.hasMediaSource && activeProject.sourceType === 'youtube' ? (
                <div className="mt-3 p-4 rounded-lg bg-[#090B10] border border-indigo-500/30 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <Sparkles className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="text-xs text-slate-200 space-y-1 leading-relaxed">
                      <p className="font-semibold text-indigo-300">
                        YouTube Direct AI Analysis Ready
                      </p>
                      <p className="text-slate-300">
                        {inspectResult?.permissionReason ||
                          'ClipGenius AI analyzes this YouTube video directly to generate timestamped transcripts, viral hooks, engagement scores, SRT captions, and timestamped clip previews. Attach an MP4/MOV file anytime if you also want standalone FFmpeg MP4 downloads.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <input
                      ref={attachFileRef}
                      type="file"
                      accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.m4v,.mkv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) void handleUploadFile(f, activeProject.id);
                      }}
                    />
                    <button
                      type="button"
                      disabled={uploading}
                      onClick={() => attachFileRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      {uploading && uploadProgress
                        ? `Uploading ${uploadProgress.percent}%...`
                        : uploading
                          ? 'Inspecting...'
                          : 'Attach Source MP4 (Optional)'}
                    </button>
                    {samples[0] && (
                      <button
                        type="button"
                        disabled={busyAction}
                        onClick={() => void handleUseSample(samples[0].id, activeProject.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <FileVideo className="w-3.5 h-3.5" aria-hidden="true" />
                        {busyAction ? 'Attaching Sample...' : 'Switch to Studio Sample'}
                      </button>
                    )}
                  </div>
                </div>
              ) : activeProject.hasMediaSource ? (
                <p className="text-xs text-emerald-400 flex items-center gap-1.5 pt-1">
                  <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  Authorized video stream ready for FFmpeg audio extraction, AI clipping &amp; MP4 rendering
                </p>
              ) : null}
            </div>
          </div>

          {/* Step 2 & 3: Clip Generation Controls */}
          {(activeProject.hasMediaSource || activeProject.sourceType === 'youtube') && (
            <div className="pt-5 border-t border-white/10 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-semibold text-white">
                  Step 2. Clip Generation Preferences
                </h3>
                <span className="text-xs text-slate-400">
                  AI selects story-complete start/end timestamps automatically
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <label htmlFor="cfg-clips" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Number of Clips
                  </label>
                  <div className="flex items-center gap-1.5">
                    {[3, 5, 10].map((num) => (
                      <button
                        key={num}
                        type="button"
                        onClick={() => {
                          setCustomClipCount(false);
                          setConfig((c) => ({ ...c, clipCount: num }));
                        }}
                        className={`flex-1 py-2 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                          !customClipCount && config.clipCount === num
                            ? 'bg-indigo-600 text-white border-indigo-500'
                            : 'bg-[#090B10] text-slate-300 border-white/10 hover:border-white/25'
                        }`}
                      >
                        {num}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCustomClipCount(true)}
                      className={`px-2.5 py-2 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                        customClipCount
                          ? 'bg-indigo-600 text-white border-indigo-500'
                          : 'bg-[#090B10] text-slate-300 border-white/10 hover:border-white/25'
                      }`}
                    >
                      Custom
                    </button>
                  </div>
                  {customClipCount && (
                    <input
                      id="cfg-clips"
                      type="number"
                      min={1}
                      max={10}
                      value={config.clipCount}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          clipCount: Math.max(1, Math.min(10, Number(e.target.value) || 1)),
                        }))
                      }
                      className="mt-2 w-full px-3 py-1.5 text-xs bg-[#090B10] border border-white/10 rounded-md text-white"
                    />
                  )}
                </div>

                <div>
                  <label htmlFor="cfg-duration" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Target Clip Duration
                  </label>
                  <select
                    id="cfg-duration"
                    value={config.clipDuration}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, clipDuration: Number(e.target.value) }))
                    }
                    className="w-full px-3 py-2 text-xs bg-[#090B10] border border-white/10 rounded-md text-white"
                  >
                    <option value={15}>15 seconds</option>
                    <option value={30}>30 seconds</option>
                    <option value={45}>45 seconds</option>
                    <option value={60}>60 seconds</option>
                    <option value={90}>90 seconds</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="cfg-ratio" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Video Format
                  </label>
                  <select
                    id="cfg-ratio"
                    value={config.aspectRatio}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, aspectRatio: e.target.value as AspectRatio }))
                    }
                    className="w-full px-3 py-2 text-xs bg-[#090B10] border border-white/10 rounded-md text-white"
                  >
                    <option value="9:16">9:16 Vertical (Reels / Shorts)</option>
                    <option value="1:1">1:1 Square (Feed)</option>
                    <option value="16:9">16:9 Landscape</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="cfg-captions" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Caption Style
                  </label>
                  <select
                    id="cfg-captions"
                    value={config.captionStyle}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, captionStyle: e.target.value as CaptionStyle }))
                    }
                    className="w-full px-3 py-2 text-xs bg-[#090B10] border border-white/10 rounded-md text-white"
                  >
                    {CAPTION_STYLES.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="cfg-theme" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Video Theme
                  </label>
                  <select
                    id="cfg-theme"
                    value={normalizeVideoTheme(config.videoTheme)}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, videoTheme: e.target.value as VideoTheme }))
                    }
                    className="w-full px-3 py-2 text-xs bg-[#090B10] border border-white/10 rounded-md text-white"
                  >
                    {VIDEO_THEMES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="cfg-style" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Content Style
                  </label>
                  <select
                    id="cfg-style"
                    value={config.contentStyle}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, contentStyle: e.target.value as ContentStyle }))
                    }
                    className="w-full px-3 py-2 text-xs bg-[#090B10] border border-white/10 rounded-md text-white"
                  >
                    <option value="Podcast">Podcast</option>
                    <option value="Educational">Educational</option>
                    <option value="Business">Business</option>
                    <option value="Motivational">Motivational</option>
                    <option value="Entertainment">Entertainment</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="cfg-resolution" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Export Resolution
                  </label>
                  <select
                    id="cfg-resolution"
                    value={config.resolution}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        resolution: e.target.value as ExportResolution,
                      }))
                    }
                    className="w-full px-3 py-2 text-xs bg-[#090B10] border border-white/10 rounded-md text-white"
                  >
                    <option value="1080p">1080p Full HD</option>
                    <option value="720p">720p Fast Export</option>
                  </select>
                </div>

                <div className="sm:col-span-2 flex flex-wrap items-center gap-x-5 gap-y-2 pt-4">
                  {[
                    { key: 'enhanceAudio', label: 'Audio Enhancement' },
                    { key: 'trimSilence', label: 'Trim Silence' },
                    { key: 'bgMusic', label: 'Ambient Bed Music' },
                    { key: 'includeIntroOutro', label: 'Intro/Outro Fade' },
                  ].map((toggle) => (
                    <label
                      key={toggle.key}
                      className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(config[toggle.key as keyof ProjectConfig])}
                        onChange={(e) =>
                          setConfig((c) => ({ ...c, [toggle.key]: e.target.checked }))
                        }
                        className="rounded border-white/20 bg-[#090B10] text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{toggle.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  disabled={busyAction || isRunning}
                  onClick={() => void handleStartPipeline()}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
                >
                  {isRunning ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Sparkles className="w-4 h-4" aria-hidden="true" />
                  )}
                  {isRunning ? 'Processing Video...' : 'Generate AI Clips'}
                </button>
              </div>
            </div>
          )}

          {/* Live Stage Progress */}
          {(isRunning || activeProject.status === 'error') && (
            <div className="pt-5 border-t border-white/10 space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-white">
                  {activeProject.status === 'error'
                    ? 'Processing Stopped'
                    : progress?.message || 'Processing video...'}
                </span>
                <span className="font-mono text-indigo-300 tabular-nums">
                  {progress?.percent ?? 15}%
                </span>
              </div>

              <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    activeProject.status === 'error' ? 'bg-rose-500' : 'bg-indigo-500'
                  }`}
                  style={{ width: `${progress?.percent ?? 15}%` }}
                />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                {PIPELINE_STEPS.map((st, idx) => {
                  const stageIdx = PIPELINE_STEPS.findIndex((p) => p.key === progress?.stage);
                  const completed = progress?.stage === 'completed' || stageIdx > idx;
                  const active = stageIdx === idx && isRunning;
                  return (
                    <div
                      key={st.key}
                      className={`p-2.5 rounded-md border ${
                        completed
                          ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300'
                          : active
                            ? 'border-indigo-500/40 bg-indigo-950/30 text-white'
                            : 'border-white/10 bg-[#090B10] text-slate-500'
                      }`}
                    >
                      {st.label}
                    </div>
                  );
                })}
              </div>

              {activeProject.status === 'error' && (
                <div className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-xs text-rose-200">
                  <span>{activeProject.errorMessage || progress?.message}</span>
                  <button
                    type="button"
                    onClick={() => void handleStartPipeline()}
                    className="px-3 py-1.5 font-semibold text-white bg-rose-600 hover:bg-rose-500 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Step 5: Generated Clips Results Dashboard */}
      {activeProject?.clips && activeProject.clips.length > 0 && (
        <section className="space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
            <div>
              <h2 className="font-display text-xl font-bold text-white">
                Generated Clips ({activeProject.clips.length})
              </h2>
              <p className="text-xs text-slate-400">
                Engagement scores are heuristic AI estimates across hook, relevance, emotion, info value, and completeness—not a guarantee of virality.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {activeProject.clips.map((clip) => {
              const showScores = Boolean(expandedScores[clip.id]);
              const themeMeta = getVideoThemeMeta(clip.videoTheme);
              const isDownloading = downloadingClipId === clip.id;
              return (
                <article
                  key={clip.id}
                  className="rounded-xl bg-[#111520] border border-white/10 overflow-hidden flex flex-col justify-between"
                >
                  <div>
                    <div className="bg-black flex flex-col items-center justify-center relative overflow-hidden">
                      {clip.renderStatus === 'ready' ? (
                        <video
                          key={`${clip.id}-${clip.renderStatus}-${clip.fileSizeBytes}`}
                          controls
                          playsInline
                          preload="metadata"
                          src={`${clip.videoUrl}?token=${encodeURIComponent(token || '')}&s=${clip.renderStatus}&sz=${clip.fileSizeBytes}&v=${encodeURIComponent(clip.createdAt)}`}
                          className={`w-full ${
                            clip.aspectRatio === '9:16'
                              ? 'max-h-[420px] aspect-[9/16]'
                              : clip.aspectRatio === '1:1'
                                ? 'max-h-[360px] aspect-square'
                                : 'aspect-video'
                          } object-contain bg-black`}
                        />
                      ) : activeProject.youtubeId ? (
                        <div className="w-full flex flex-col">
                          <div className="relative overflow-hidden">
                            <iframe
                              title={`YouTube clip preview: ${clip.title}`}
                              src={buildYouTubeEmbedUrl(activeProject.youtubeId, clip.startSec, clip.endSec)}
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                              referrerPolicy="strict-origin-when-cross-origin"
                              style={{ filter: themeMeta.cssFilter }}
                              className="w-full aspect-video border-0 bg-black"
                            />
                            {themeMeta.overlayClass && (
                              <div className={`pointer-events-none absolute inset-0 ${themeMeta.overlayClass}`} />
                            )}
                          </div>
                          {clip.captions[0] && (
                            <div className="px-3 py-2.5 bg-[#090B10] border-t border-white/10 flex justify-center">
                              <FancyCaptionOverlay
                                line={clip.captions[0]}
                                captionStyle={clip.captionStyle}
                                fontFamily={clip.fontFamily}
                                highlightColor={clip.highlightColor}
                                compact
                              />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="w-full h-56 flex flex-col items-center justify-center text-xs text-slate-400 gap-2">
                          {clip.renderStatus === 'rendering' ? (
                            <>
                              <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                              <span>Rendering MP4...</span>
                            </>
                          ) : (
                            <span>Open Editor or Download to render MP4</span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="p-5 space-y-3">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-400 font-mono tabular-nums">
                          <span>
                            {formatTimecode(clip.startSec)} – {formatTimecode(clip.endSec)} ·{' '}
                            {Math.round(clip.durationSec)}s · {clip.aspectRatio}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedScores((prev) => ({ ...prev, [clip.id]: !prev[clip.id] }))
                            }
                            className="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer whitespace-nowrap shrink-0"
                          >
                            Est. {clip.viralScore}/100
                          </button>
                        </div>
                        <p className="text-[11px] text-slate-400 font-mono">
                          Theme: <span className="text-slate-200">{normalizeVideoTheme(clip.videoTheme)}</span> · Captions:{' '}
                          <span className="text-indigo-300">{clip.captionStyle}</span>
                        </p>
                      </div>

                      {showScores && (
                        <div className="p-3 rounded-lg bg-[#090B10] border border-white/10 space-y-1.5 text-xs">
                          <p className="text-[11px] text-slate-400 mb-2">
                            Estimated engagement breakdown (not a guarantee):
                          </p>
                          {[
                            ['Opening Hook', clip.scoreBreakdown.hookStrength],
                            ['Audience Relevance', clip.scoreBreakdown.audienceRelevance],
                            ['Emotional Impact', clip.scoreBreakdown.emotionalImpact],
                            ['Information Value', clip.scoreBreakdown.infoValue],
                            ['Story Completeness', clip.scoreBreakdown.storyCompleteness],
                          ].map(([label, val]) => (
                            <div key={String(label)} className="flex items-center justify-between">
                              <span className="text-slate-300">{label}</span>
                              <span className="font-mono text-white tabular-nums">{val}/100</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <h3 className="font-display text-base font-semibold text-white leading-snug">
                        {clip.title}
                      </h3>
                      <p className="text-xs text-indigo-300 leading-relaxed">
                        Hook: “{clip.hook}”
                      </p>
                      <p className="text-xs text-slate-400 leading-relaxed">{clip.description}</p>
                      <p className="text-xs text-slate-500 font-mono">{clip.hashtags}</p>
                    </div>
                  </div>

                  <div className="px-5 pb-5 pt-3 border-t border-white/10 space-y-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={isDownloading}
                        onClick={() => void handleDownloadClipMp4(clip)}
                        aria-label={`Download MP4 for ${clip.title}`}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-md whitespace-nowrap cursor-pointer disabled:opacity-60"
                      >
                        {isDownloading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Download className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        {isDownloading
                          ? 'Preparing MP4...'
                          : clip.renderStatus === 'ready' && clip.fileSizeBytes > 0
                            ? `Download Video (${formatFileSize(clip.fileSizeBytes)})`
                            : 'Download Video (MP4)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditClip(clip, activeProject)}
                        aria-label={`Edit & AI Style ${clip.title}`}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-indigo-200 bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/35 rounded-md whitespace-nowrap cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                        Edit &amp; AI Style
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <a
                        href={`/api/clips/${clip.id}/srt?token=${encodeURIComponent(token || '')}`}
                        aria-label={`Download SRT captions for ${clip.title}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md whitespace-nowrap"
                      >
                        <Subtitles className="w-3 h-3" aria-hidden="true" />
                        Download .SRT
                      </a>
                      <button
                        type="button"
                        disabled={regeneratingId === clip.id}
                        onClick={() => void handleRegenerateClip(clip.id)}
                        aria-label={`Regenerate copy for ${clip.title}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md whitespace-nowrap cursor-pointer disabled:opacity-60"
                      >
                        <RefreshCw
                          className={`w-3 h-3 ${regeneratingId === clip.id ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                        Regenerate Copy
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* Full Transcript Panel */}
      {activeProject && activeProject.transcript.length > 0 && (
        <section className="p-6 rounded-xl bg-[#111520] border border-white/10 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="font-display text-lg font-semibold text-white">
              Source Transcript ({activeProject.transcript.length} segments)
            </h2>
            <input
              type="search"
              value={transcriptQuery}
              onChange={(e) => setTranscriptQuery(e.target.value)}
              placeholder="Search transcript keywords..."
              aria-label="Search transcript keywords"
              className="w-full sm:w-64 px-3 py-1.5 text-xs bg-[#090B10] border border-white/10 rounded-md text-white focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-white/10 pr-2">
            {filteredTranscript.map((seg) => (
              <div key={seg.id} className="py-2.5 flex items-start gap-4 text-xs">
                <span className="font-mono text-slate-400 tabular-nums shrink-0 pt-0.5">
                  {formatTimecode(seg.start)} – {formatTimecode(seg.end)}
                </span>
                <div className="space-y-0.5">
                  {seg.speaker && (
                    <span className="font-semibold text-indigo-400 mr-2">{seg.speaker}:</span>
                  )}
                  <span className="text-slate-200 leading-relaxed">{seg.text}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
