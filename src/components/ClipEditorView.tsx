import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Loader2,
  Pause,
  Play,
  Plus,
  Save,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type {
  AspectRatio,
  CaptionLine,
  CaptionStyle,
  ClipDTO,
  ExportResolution,
  ProjectDTO,
} from '../shared/types';
import { formatFileSize, formatPreciseTimecode } from '../utils/youtube';

interface ClipEditorViewProps {
  clip: ClipDTO;
  project: ProjectDTO;
  onBack: () => void;
  onClipUpdated: (updated: ClipDTO) => void;
}

const HIGHLIGHT_SWATCHES = ['#38BDF8', '#A78BFA', '#FBBF24', '#34D399', '#FB7185'];

export function ClipEditorView({
  clip,
  project,
  onBack,
  onClipUpdated,
}: ClipEditorViewProps) {
  const { authFetch, token } = useAuth();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [title, setTitle] = useState(clip.title);
  const [hook, setHook] = useState(clip.hook);
  const [description, setDescription] = useState(clip.description);
  const [hashtags, setHashtags] = useState(clip.hashtags);

  const [startSec, setStartSec] = useState(clip.startSec);
  const [endSec, setEndSec] = useState(clip.endSec);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(clip.aspectRatio);
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(clip.captionStyle);
  const [fontFamily, setFontFamily] = useState(clip.fontFamily);
  const [highlightColor, setHighlightColor] = useState(clip.highlightColor);
  const [cropX, setCropX] = useState(clip.cropX);
  const [resolution, setResolution] = useState<ExportResolution>(clip.renderResolution);
  const [enhanceAudio, setEnhanceAudio] = useState(clip.enhanceAudio);
  const [trimSilence, setTrimSilence] = useState(clip.trimSilence);
  const [bgMusic, setBgMusic] = useState(clip.bgMusic);
  const [includeIntroOutro, setIncludeIntroOutro] = useState(clip.includeIntroOutro);
  const [captions, setCaptions] = useState<CaptionLine[]>(clip.captions);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');

  const maxSourceDuration = Math.max(
    endSec + 1,
    project.durationSec > 0 ? project.durationSec : endSec
  );

  const activePreviewCaption = useMemo(() => {
    return captions.find((c) => currentTime >= c.start && currentTime <= c.end) ?? null;
  }, [captions, currentTime]);

  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      void vid.play();
      setPlaying(true);
    } else {
      vid.pause();
      setPlaying(false);
    }
  };

  const handleSaveAndRender = async () => {
    setError('');
    setStatusMsg('');
    setSaving(true);
    try {
      const res = await authFetch(`/api/clips/${clip.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          hook,
          description,
          hashtags,
          startSec,
          endSec,
          aspectRatio,
          captionStyle,
          fontFamily,
          highlightColor,
          cropX,
          renderResolution: resolution,
          enhanceAudio,
          trimSilence,
          bgMusic,
          includeIntroOutro,
          captions,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to render updated clip.');
      onClipUpdated(data.clip);
      setStatusMsg('Clip re-rendered cleanly with FFmpeg.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save clip edits.');
    } finally {
      setSaving(false);
    }
  };

  const updateCaptionLine = (index: number, patch: Partial<CaptionLine>) => {
    setCaptions((prev) => prev.map((item, idx) => (idx === index ? { ...item, ...patch } : item)));
  };

  const addCaptionLine = () => {
    const lastEnd = captions.length > 0 ? captions[captions.length - 1].end : 0;
    setCaptions((prev) => [
      ...prev,
      {
        id: `cap-${Date.now()}`,
        start: Number(lastEnd.toFixed(1)),
        end: Number((lastEnd + 2.5).toFixed(1)),
        text: 'New subtitle line',
      },
    ]);
  };

  return (
    <div className="space-y-6">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            Back to Clips
          </button>
          <div className="min-w-0">
            <h1 className="font-display text-xl font-bold text-white truncate">{title}</h1>
            <p className="text-xs text-slate-400 font-mono tabular-nums">
              {aspectRatio} · {resolution} · {formatFileSize(clip.fileSizeBytes)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSaveAndRender()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="w-4 h-4" aria-hidden="true" />
            )}
            {saving ? 'Rendering MP4...' : 'Save & Re-Render MP4'}
          </button>

          <a
            href={`/api/clips/${clip.id}/download?resolution=${encodeURIComponent(resolution)}&token=${encodeURIComponent(token || '')}`}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-100 bg-white/10 hover:bg-white/15 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            Download MP4
          </a>
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3.5 rounded-lg bg-rose-950/40 border border-rose-500/30 text-sm text-rose-200">
          {error}
        </div>
      )}
      {statusMsg && (
        <div role="status" className="p-3.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-sm text-emerald-200">
          {statusMsg}
        </div>
      )}

      {/* Main Editor Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Video Player & Timeline */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-4 rounded-xl bg-[#111520] border border-white/10 space-y-4">
            <div className="relative bg-black rounded-lg overflow-hidden flex items-center justify-center min-h-[340px]">
              <video
                ref={videoRef}
                key={`${clip.videoUrl}-${clip.fileSizeBytes}-${clip.createdAt}`}
                src={`${clip.videoUrl}?token=${encodeURIComponent(token || '')}&v=${Date.now()}`}
                playsInline
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                onEnded={() => setPlaying(false)}
                className={`w-full ${
                  aspectRatio === '9:16'
                    ? 'max-h-[440px] aspect-[9/16]'
                    : aspectRatio === '1:1'
                      ? 'max-h-[380px] aspect-square'
                      : 'aspect-video'
                } object-contain`}
              />

              {/* Live Caption Style Preview Overlay */}
              {activePreviewCaption && (
                <div className="pointer-events-none absolute inset-x-6 bottom-10 text-center">
                  <span
                    style={{
                      fontFamily,
                      color: captionStyle === 'Karaoke' ? highlightColor : '#FFFFFF',
                    }}
                    className={`inline-block px-3 py-1 text-sm leading-snug ${
                      captionStyle === 'Bold'
                        ? 'font-extrabold uppercase tracking-wide drop-shadow-[0_2px_4px_rgba(0,0,0,0.95)]'
                        : captionStyle === 'Modern'
                          ? 'bg-black/75 rounded-md font-semibold'
                          : 'font-medium drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]'
                    }`}
                  >
                    {activePreviewCaption.text}
                  </span>
                </div>
              )}
            </div>

            {/* Playback & Timeline Scrub */}
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label={playing ? 'Pause preview' : 'Play preview'}
                  className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer shrink-0"
                >
                  {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  aria-label="Timeline scrub"
                  min={0}
                  max={Math.max(1, endSec - startSec)}
                  step={0.1}
                  value={currentTime}
                  onChange={(e) => {
                    const t = Number(e.target.value);
                    setCurrentTime(t);
                    if (videoRef.current) videoRef.current.currentTime = t;
                  }}
                  className="flex-1 accent-indigo-500"
                />
                <span className="font-mono text-xs text-slate-300 tabular-nums shrink-0">
                  {formatPreciseTimecode(currentTime)} / {formatPreciseTimecode(endSec - startSec)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-4 pt-1">
                <label className="flex items-center gap-2 text-xs text-slate-300 flex-1">
                  <span>Volume</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setVolume(v);
                      if (videoRef.current) videoRef.current.volume = v;
                    }}
                    className="w-full accent-indigo-500"
                  />
                </label>
                <span className="font-mono text-xs text-slate-400 tabular-nums">
                  {Math.round(volume * 100)}%
                </span>
              </div>
            </div>
          </div>

          {/* Trim & Crop Framing */}
          <div className="p-5 rounded-xl bg-[#111520] border border-white/10 space-y-4">
            <h2 className="font-display text-sm font-semibold text-white">
              Clip Trimming &amp; Smart Framing
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="trim-start" className="block text-xs text-slate-400 mb-1">
                  Start Time (sec)
                </label>
                <input
                  id="trim-start"
                  type="number"
                  min={0}
                  max={Math.max(0, endSec - 2)}
                  step={0.5}
                  value={startSec}
                  onChange={(e) =>
                    setStartSec(Math.max(0, Math.min(endSec - 2, Number(e.target.value) || 0)))
                  }
                  className="w-full px-3 py-1.5 text-xs font-mono bg-[#090B10] border border-white/10 rounded-md text-white"
                />
              </div>
              <div>
                <label htmlFor="trim-end" className="block text-xs text-slate-400 mb-1">
                  End Time (sec)
                </label>
                <input
                  id="trim-end"
                  type="number"
                  min={startSec + 2}
                  max={maxSourceDuration}
                  step={0.5}
                  value={endSec}
                  onChange={(e) =>
                    setEndSec(
                      Math.min(maxSourceDuration, Math.max(startSec + 2, Number(e.target.value) || startSec + 2))
                    )
                  }
                  className="w-full px-3 py-1.5 text-xs font-mono bg-[#090B10] border border-white/10 rounded-md text-white"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <label htmlFor="crop-x" className="text-slate-300">
                  Speaker Crop Focus (Horizontal X)
                </label>
                <span className="font-mono text-slate-400 tabular-nums">
                  {Math.round(cropX * 100)}%
                </span>
              </div>
              <input
                id="crop-x"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={cropX}
                onChange={(e) => setCropX(Number(e.target.value))}
                className="w-full accent-indigo-500"
              />
            </div>
          </div>
        </div>

        {/* Right: Style, Metadata, Audio, & Subtitle Editor */}
        <div className="lg:col-span-7 space-y-5">
          {/* Format & Style Controls */}
          <section className="p-5 rounded-xl bg-[#111520] border border-white/10 space-y-4">
            <h2 className="font-display text-sm font-semibold text-white">
              Format, Typography &amp; Audio
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label htmlFor="ed-ratio" className="block text-xs text-slate-400 mb-1">
                  Aspect Ratio
                </label>
                <select
                  id="ed-ratio"
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                  className="w-full px-3 py-2 text-xs bg-[#090B10] border border-white/10 rounded-md text-white"
                >
                  <option value="9:16">9:16 Vertical</option>
                  <option value="1:1">1:1 Square</option>
                  <option value="16:9">16:9 Landscape</option>
                </select>
              </div>

              <div>
                <label htmlFor="ed-caption-style" className="block text-xs text-slate-400 mb-1">
                  Caption Style
                </label>
                <select
                  id="ed-caption-style"
                  value={captionStyle}
                  onChange={(e) => setCaptionStyle(e.target.value as CaptionStyle)}
                  className="w-full px-3 py-2 text-xs bg-[#090B10] border border-white/10 rounded-md text-white"
                >
                  <option value="Modern">Modern</option>
                  <option value="Animated">Animated</option>
                  <option value="Bold">Bold</option>
                  <option value="Karaoke">Karaoke</option>
                  <option value="Minimal">Minimal</option>
                </select>
              </div>

              <div>
                <label htmlFor="ed-res" className="block text-xs text-slate-400 mb-1">
                  Export Quality
                </label>
                <select
                  id="ed-res"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as ExportResolution)}
                  className="w-full px-3 py-2 text-xs bg-[#090B10] border border-white/10 rounded-md text-white"
                >
                  <option value="1080p">1080p HD</option>
                  <option value="720p">720p Standard</option>
                </select>
              </div>

              <div>
                <label htmlFor="ed-font" className="block text-xs text-slate-400 mb-1">
                  Caption Font
                </label>
                <select
                  id="ed-font"
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-[#090B10] border border-white/10 rounded-md text-white"
                >
                  <option value="Plus Jakarta Sans">Plus Jakarta Sans</option>
                  <option value="DM Sans">DM Sans</option>
                  <option value="JetBrains Mono">JetBrains Mono</option>
                  <option value="Arial">Arial Clean</option>
                </select>
              </div>

              <div className="sm:col-span-2">
                <span className="block text-xs text-slate-400 mb-1.5">Keyword Highlight Color</span>
                <div className="flex items-center gap-2">
                  {HIGHLIGHT_SWATCHES.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      aria-label={`Highlight color ${hex}`}
                      onClick={() => setHighlightColor(hex)}
                      style={{ backgroundColor: hex }}
                      className={`w-7 h-7 rounded-md cursor-pointer border-2 transition-transform ${
                        highlightColor === hex ? 'border-white scale-105' : 'border-transparent'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-2 border-t border-white/10">
              {[
                { label: 'Enhance Audio (Loudness)', val: enhanceAudio, set: setEnhanceAudio },
                { label: 'Trim Silence', val: trimSilence, set: setTrimSilence },
                { label: 'Ambient Bed Music', val: bgMusic, set: setBgMusic },
                { label: 'Intro / Outro Fade', val: includeIntroOutro, set: setIncludeIntroOutro },
              ].map((item) => (
                <label
                  key={item.label}
                  className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={item.val}
                    onChange={(e) => item.set(e.target.checked)}
                    className="rounded border-white/20 bg-[#090B10] text-indigo-600"
                  />
                  <span>{item.label}</span>
                </label>
              ))}
            </div>
          </section>

          {/* Subtitle Line Editor */}
          <section className="p-5 rounded-xl bg-[#111520] border border-white/10 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-white">
                Subtitle Editor ({captions.length} lines)
              </h2>
              <button
                type="button"
                onClick={addCaptionLine}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-indigo-300 bg-indigo-600/15 hover:bg-indigo-600/25 rounded-md cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                Add Line
              </button>
            </div>

            <div className="max-h-64 overflow-y-auto space-y-2.5 pr-1">
              {captions.map((line, idx) => (
                <div
                  key={line.id}
                  className="p-2.5 rounded-lg bg-[#090B10] border border-white/10 flex flex-col sm:flex-row sm:items-center gap-2"
                >
                  <div className="flex items-center gap-1.5 shrink-0">
                    <input
                      type="number"
                      aria-label={`Line ${idx + 1} start seconds`}
                      step={0.1}
                      value={line.start}
                      onChange={(e) =>
                        updateCaptionLine(idx, { start: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-16 px-2 py-1 text-xs font-mono bg-[#111520] border border-white/10 rounded text-white"
                    />
                    <span className="text-slate-500 text-xs">–</span>
                    <input
                      type="number"
                      aria-label={`Line ${idx + 1} end seconds`}
                      step={0.1}
                      value={line.end}
                      onChange={(e) =>
                        updateCaptionLine(idx, { end: Math.max(0.2, Number(e.target.value) || 0.5) })
                      }
                      className="w-16 px-2 py-1 text-xs font-mono bg-[#111520] border border-white/10 rounded text-white"
                    />
                  </div>
                  <input
                    type="text"
                    aria-label={`Line ${idx + 1} caption text`}
                    value={line.text}
                    onChange={(e) => updateCaptionLine(idx, { text: e.target.value })}
                    className="flex-1 px-2.5 py-1 text-xs bg-[#111520] border border-white/10 rounded text-white"
                  />
                  <button
                    type="button"
                    aria-label={`Remove caption line ${idx + 1}`}
                    onClick={() => setCaptions((prev) => prev.filter((_, i) => i !== idx))}
                    className="p-1.5 text-slate-400 hover:text-rose-400 cursor-pointer shrink-0 self-end sm:self-center"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Title, Hook, Description */}
          <section className="p-5 rounded-xl bg-[#111520] border border-white/10 space-y-3">
            <h2 className="font-display text-sm font-semibold text-white">
              Social Metadata
            </h2>
            <div>
              <label htmlFor="ed-title" className="block text-xs text-slate-400 mb-1">
                Clip Title
              </label>
              <input
                id="ed-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#090B10] border border-white/10 rounded-md text-white"
              />
            </div>
            <div>
              <label htmlFor="ed-hook" className="block text-xs text-slate-400 mb-1">
                Opening Hook
              </label>
              <input
                id="ed-hook"
                type="text"
                value={hook}
                onChange={(e) => setHook(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#090B10] border border-white/10 rounded-md text-white"
              />
            </div>
            <div>
              <label htmlFor="ed-desc" className="block text-xs text-slate-400 mb-1">
                Description &amp; Hashtags
              </label>
              <textarea
                id="ed-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-[#090B10] border border-white/10 rounded-md text-white"
              />
              <input
                type="text"
                aria-label="Hashtags"
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
                className="mt-2 w-full px-3 py-1.5 text-xs font-mono bg-[#090B10] border border-white/10 rounded-md text-slate-300"
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
