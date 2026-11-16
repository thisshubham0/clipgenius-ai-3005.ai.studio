import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  ClipboardPaste,
  Download,
  Film,
  FolderOpen,
  Play,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { DashboardSummary, ProjectDTO } from '../shared/types';
import { formatFileSize, formatTimecode, parseYouTubeUrl } from '../utils/youtube';

interface DashboardViewProps {
  onStartAnalyzeUrl: (url: string) => void;
  onStartCreate: () => void;
  onOpenProject: (projectId: number) => void;
  onOpenDownloads: () => void;
}

export function DashboardView({
  onStartAnalyzeUrl,
  onStartCreate,
  onOpenProject,
  onOpenDownloads,
}: DashboardViewProps) {
  const { authFetch, profile, token } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quickUrl, setQuickUrl] = useState('');
  const [urlError, setUrlError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    authFetch('/api/dashboard')
      .then(async (res) => {
        if (!res.ok) throw new Error('Could not load dashboard metrics.');
        return (await res.json()) as DashboardSummary;
      })
      .then((data) => {
        if (active) {
          setSummary(data);
          setError('');
        }
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [authFetch]);

  const handlePaste = async () => {
    setUrlError('');
    try {
      const text = await navigator.clipboard.readText();
      if (text) setQuickUrl(text.trim());
    } catch {
      setQuickUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseYouTubeUrl(quickUrl);
    if (!parsed.valid) {
      setUrlError(parsed.error || 'Enter a valid YouTube link.');
      return;
    }
    onStartAnalyzeUrl(quickUrl.trim());
  };

  const firstName = profile?.displayName?.split(' ')[0] || 'Creator';

  return (
    <div className="space-y-8">
      {/* Welcome & Quick Launcher */}
      <section className="p-6 rounded-xl bg-[#111520] border border-white/10 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold text-white">
              Welcome back, {firstName}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Paste a YouTube link to inspect metadata or upload your video to generate short-form MP4 clips.
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onStartCreate}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Upload className="w-4 h-4" aria-hidden="true" />
              Upload Video
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-2">
          <label htmlFor="dashboard-youtube-url" className="sr-only">
            YouTube Video URL
          </label>
          <div className="flex flex-col sm:flex-row gap-2.5 p-2 rounded-lg bg-[#090B10] border border-white/10">
            <input
              id="dashboard-youtube-url"
              type="text"
              value={quickUrl}
              onChange={(e) => {
                setQuickUrl(e.target.value);
                if (urlError) setUrlError('');
              }}
              placeholder="https://www.youtube.com/watch?v=... or youtu.be/..."
              className="flex-1 bg-transparent px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none"
            />
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handlePaste}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ClipboardPaste className="w-3.5 h-3.5" aria-hidden="true" />
                Paste Link
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Analyze Video
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          </div>
          {urlError && (
            <p role="alert" className="text-xs text-rose-400">
              {urlError}
            </p>
          )}
        </form>
      </section>

      {/* Metrics Strip */}
      <section aria-label="Workspace metrics" className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="p-5 rounded-xl bg-[#111520] border border-white/10">
          <p className="text-xs font-medium text-slate-400">Total Videos Processed</p>
          <p className="mt-2 font-mono text-3xl font-bold text-white tabular-nums">
            {loading ? '—' : summary?.totalVideos ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500">Synced with PostgreSQL workspace</p>
        </div>

        <div className="p-5 rounded-xl bg-[#111520] border border-white/10">
          <p className="text-xs font-medium text-slate-400">Total Clips Generated</p>
          <p className="mt-2 font-mono text-3xl font-bold text-white tabular-nums">
            {loading ? '—' : summary?.totalClips ?? 0}
          </p>
          <p className="mt-1 text-xs text-slate-500">Rendered MP4 exports ready</p>
        </div>

        <div className="p-5 rounded-xl bg-[#111520] border border-white/10">
          <p className="text-xs font-medium text-slate-400">Available Processing Credits</p>
          <p className="mt-2 font-mono text-3xl font-bold text-indigo-400 tabular-nums">
            {loading ? '—' : summary?.credits ?? profile?.credits ?? 120}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {summary?.plan ?? profile?.plan ?? 'Studio Pro'} plan
          </p>
        </div>
      </section>

      {error && (
        <div role="alert" className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* Recent Projects & Downloads */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 p-6 rounded-xl bg-[#111520] border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-white">Recent Projects</h2>
            <button
              type="button"
              onClick={onStartCreate}
              className="text-xs font-medium text-indigo-400 hover:text-indigo-300 cursor-pointer"
            >
              New Project
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-16 rounded-lg bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : !summary || summary.recentProjects.length === 0 ? (
            <div className="py-10 text-center space-y-3 border border-dashed border-white/10 rounded-lg">
              <Film className="w-8 h-8 text-slate-500 mx-auto" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-white">No video projects yet</p>
                <p className="mt-1 text-xs text-slate-400">
                  Start by inspecting a YouTube link, uploading an MP4, or running an Authorized Studio Sample.
                </p>
              </div>
              <button
                type="button"
                onClick={onStartCreate}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                Create First Clips
              </button>
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {summary.recentProjects.map((proj: ProjectDTO) => (
                <div
                  key={proj.id}
                  className="py-3.5 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <img
                      src={proj.thumbnailUrl || '/src/assets/images/hero_studio_preview_1794825184394.jpg'}
                      alt={proj.title}
                      referrerPolicy="no-referrer"
                      className="w-16 h-10 rounded object-cover border border-white/10 shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{proj.title}</p>
                      <p className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                        <span className="capitalize">{proj.status}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {proj.clipCount ?? 0} clips
                        </span>
                        {proj.durationSec > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {formatTimecode(proj.durationSec)}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenProject(proj.id)}
                    aria-label={`Open project ${proj.title}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />
                    Open
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="lg:col-span-5 p-6 rounded-xl bg-[#111520] border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-white">Recent Exports</h2>
            <button
              type="button"
              onClick={onOpenDownloads}
              className="text-xs font-medium text-indigo-400 hover:text-indigo-300 cursor-pointer"
            >
              Download Center
            </button>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((n) => (
                <div key={n} className="h-14 rounded-lg bg-white/5 animate-pulse" />
              ))}
            </div>
          ) : !summary || summary.recentDownloads.length === 0 ? (
            <div className="py-10 text-center space-y-2 border border-dashed border-white/10 rounded-lg">
              <Download className="w-7 h-7 text-slate-500 mx-auto" aria-hidden="true" />
              <p className="text-sm font-medium text-white">No downloads recorded</p>
              <p className="text-xs text-slate-400">
                Exported MP4 clips will appear here with resolution and file size.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {summary.recentDownloads.map((dl) => (
                <div key={dl.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{dl.clipTitle}</p>
                    <p className="text-xs text-slate-400 mt-0.5 font-mono tabular-nums">
                      {dl.format} · {dl.aspectRatio} · {dl.resolution} · {formatFileSize(dl.fileSizeBytes)}
                    </p>
                  </div>
                  <a
                    href={`/api/clips/${dl.clipId}/download?resolution=${encodeURIComponent(dl.resolution)}&token=${encodeURIComponent(token || '')}`}
                    aria-label={`Re-download ${dl.clipTitle}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md whitespace-nowrap shrink-0"
                  >
                    <Play className="w-3 h-3" aria-hidden="true" />
                    MP4
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
