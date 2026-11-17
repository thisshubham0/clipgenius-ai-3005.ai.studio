import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  Loader2,
  Palette,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Subtitles,
  Trash2,
  Wand2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type {
  AspectRatio,
  CaptionLine,
  CaptionStyle,
  ClipDTO,
  ExportResolution,
  ProjectDTO,
  VideoTheme,
} from '../shared/types';
import { downloadClipMp4 } from '../utils/downloadClip';
import {
  AI_EDIT_PRESETS,
  CAPTION_STYLES,
  type CaptionStyleMeta,
  VIDEO_THEMES,
  getCaptionStyleMeta,
  getVideoThemeMeta,
  normalizeCaptionStyle,
  normalizeVideoTheme,
} from '../utils/videoStyles';
import { buildYouTubeEmbedUrl, formatFileSize, formatPreciseTimecode } from '../utils/youtube';
import { FancyCaptionOverlay } from './FancyCaptionOverlay';

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
  const [videoTheme, setVideoTheme] = useState<VideoTheme>(normalizeVideoTheme(clip.videoTheme));
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>(
    normalizeCaptionStyle(clip.captionStyle)
  );
  const [fontFamily, setFontFamily] = useState(clip.fontFamily);
  const [highlightColor, setHighlightColor] = useState(clip.highlightColor);
  const [cropX, setCropX] = useState(clip.cropX);
  const [resolution, setResolution] = useState<ExportResolution>(clip.renderResolution);
  const [enhanceAudio, setEnhanceAudio] = useState(clip.enhanceAudio);
  const [trimSilence, setTrimSilence] = useState(clip.trimSilence);
  const [bgMusic, setBgMusic] = useState(clip.bgMusic);
  const [includeIntroOutro, setIncludeIntroOutro] = useState(clip.includeIntroOutro);
  const [captions, setCaptions] = useState<CaptionLine[]>(clip.captions);

  const [aiPrompt, setAiPrompt] = useState('');
  const [aiEditing, setAiEditing] = useState(false);
  const [aiSummary, setAiSummary] = useState('');
  const [previewMode, setPreviewMode] = useState<'mp4' | 'youtube'>(
    clip.renderStatus === 'ready' || !project.youtubeId ? 'mp4' : 'youtube'
  );
  const [selectedCaptionIdx, setSelectedCaptionIdx] = useState(0);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const [motionReplayKey, setMotionReplayKey] = useState(0);

  const maxSourceDuration = Math.max(
    endSec + 1,
    project.durationSec > 0 ? project.durationSec : endSec
  );

  const themeMeta = useMemo(() => getVideoThemeMeta(videoTheme), [videoTheme]);
  const captionMeta = useMemo(() => getCaptionStyleMeta(captionStyle), [captionStyle]);

  const showHtml5Player =
    (previewMode === 'mp4' && clip.renderStatus === 'ready') || !project.youtubeId;

  const activePreviewCaption = useMemo(() => {
    const timed = captions.find((c) => currentTime >= c.start && currentTime <= c.end);
    if (timed) return timed;
    return captions[selectedCaptionIdx] ?? captions[0] ?? null;
  }, [captions, currentTime, selectedCaptionIdx]);

  const hasUnsavedThemeChange =
    videoTheme !== normalizeVideoTheme(clip.videoTheme);
  const hasUnsavedCaptionChange =
    captionStyle !== normalizeCaptionStyle(clip.captionStyle) ||
    fontFamily !== clip.fontFamily ||
    highlightColor !== clip.highlightColor ||
    JSON.stringify(captions) !== JSON.stringify(clip.captions);

  const applyCssThemePreview = !showHtml5Player || hasUnsavedThemeChange;

  const handleSelectCaptionTheme = (preset: CaptionStyleMeta) => {
    setCaptionStyle(preset.id);
    setFontFamily(preset.recommendedFont);
    setHighlightColor(preset.recommendedHighlight);
    setMotionReplayKey((k) => k + 1);
  };

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
          videoTheme,
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
      if (!res.ok) throw new Error(data.error || 'Failed to save clip edits.');
      onClipUpdated(data.clip);
      if (data.clip.renderStatus === 'ready') {
        setPreviewMode('mp4');
      }
      setStatusMsg(
        project.hasMediaSource
          ? 'Clip re-rendered with your video theme & captions.'
          : 'Clip theme, fancy captions, and timestamps saved. Click Download Clipped Video (MP4) anytime to export.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save clip edits.');
    } finally {
      setSaving(false);
    }
  };

  const handleAiEdit = async (promptOverride?: string) => {
    const effectivePrompt = (promptOverride ?? aiPrompt).trim();
    if (!effectivePrompt) {
      setError('Enter an editing instruction or choose a quick AI style preset.');
      return;
    }
    if (promptOverride) {
      setAiPrompt(promptOverride);
    }
    setError('');
    setStatusMsg('');
    setAiSummary('');
    setAiEditing(true);
    try {
      const res = await authFetch(`/api/clips/${clip.id}/ai-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: effectivePrompt }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'AI editing failed.');

      const updated = data.clip as ClipDTO;
      setVideoTheme(normalizeVideoTheme(updated.videoTheme));
      setCaptionStyle(normalizeCaptionStyle(updated.captionStyle));
      setFontFamily(updated.fontFamily);
      setHighlightColor(updated.highlightColor);
      setCaptions(updated.captions || []);
      setTitle(updated.title);
      setHook(updated.hook);
      setDescription(updated.description);
      setHashtags(updated.hashtags);
      setMotionReplayKey((k) => k + 1);
      if (updated.renderStatus === 'ready') {
        setPreviewMode('mp4');
      }

      onClipUpdated(updated);
      setAiSummary(
        data.aiSummary ||
          `Applied ${updated.videoTheme} theme with ${updated.captionStyle} captions.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI editing failed.');
    } finally {
      setAiEditing(false);
    }
  };

  const handleDownloadMp4 = async () => {
    setError('');
    setDownloading(true);
    try {
      await downloadClipMp4({
        clipId: clip.id,
        resolution,
        clipTitle: title,
        authFetch,
      });
      setStatusMsg(`Downloaded ${title} (${resolution} MP4 with ${videoTheme} theme & ${captionStyle} captions).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MP4 download failed.');
    } finally {
      setDownloading(false);
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
            <p className="text-xs text-slate-400 font-mono tabular-nums truncate">
              {aspectRatio} · {resolution} · {videoTheme} · {captionStyle}
              {clip.renderStatus === 'ready' && clip.fileSizeBytes > 0
                ? ` · ${formatFileSize(clip.fileSizeBytes)}`
                : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={saving || aiEditing}
            onClick={() => void handleSaveAndRender()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="w-4 h-4" aria-hidden="true" />
            )}
            {saving
              ? project.hasMediaSource
                ? 'Rendering MP4...'
                : 'Saving...'
              : project.hasMediaSource
                ? 'Save & Re-Render MP4'
                : 'Save Clip Edits'}
          </button>

          <button
            type="button"
            disabled={downloading}
            onClick={() => void handleDownloadMp4()}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
          >
            {downloading ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="w-4 h-4" aria-hidden="true" />
            )}
            {downloading ? 'Preparing MP4...' : 'Download Clipped Video (MP4)'}
          </button>

          <a
            href={`/api/clips/${clip.id}/srt?token=${encodeURIComponent(token || '')}`}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Subtitles className="w-3.5 h-3.5" aria-hidden="true" />
            .SRT
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 space-y-4">
          <div className="p-4 rounded-xl bg-[#111520] border border-white/10 space-y-4">
            {project.youtubeId && clip.renderStatus === 'ready' && (
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-400">Preview Source</span>
                <div className="inline-flex rounded-md bg-[#090B10] border border-white/10 p-0.5">
                  <button
                    type="button"
                    onClick={() => setPreviewMode('mp4')}
                    className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
                      previewMode === 'mp4' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Rendered MP4
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('youtube')}
                    className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
                      previewMode === 'youtube' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    YouTube Clip
                  </button>
                </div>
              </div>
            )}

            <div className="relative bg-black rounded-lg overflow-hidden flex items-center justify-center min-h-[300px]">
              <div
                className="w-full h-full flex items-center justify-center"
                style={{ filter: applyCssThemePreview ? themeMeta.cssFilter : 'none' }}
              >
                {showHtml5Player ? (
                  <video
                    ref={videoRef}
                    key={`${clip.videoUrl}-${clip.fileSizeBytes}-${clip.renderStatus}-${clip.createdAt}`}
                    src={`${clip.videoUrl}?token=${encodeURIComponent(token || '')}&sz=${clip.fileSizeBytes}&s=${clip.renderStatus}&v=${encodeURIComponent(clip.createdAt)}`}
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
                ) : (
                  <iframe
                    title={`YouTube clip editor preview: ${title}`}
                    src={buildYouTubeEmbedUrl(project.youtubeId || '', startSec, endSec)}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    referrerPolicy="strict-origin-when-cross-origin"
                    className="w-full aspect-video border-0"
                  />
                )}
              </div>

              {applyCssThemePreview && themeMeta.overlayClass && (
                <div className={`pointer-events-none absolute inset-0 ${themeMeta.overlayClass}`} />
              )}
            </div>

            {activePreviewCaption && (
              <div
                data-testid="live-caption-stage"
                className="p-3 rounded-lg bg-[#090B10] border border-white/10 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-slate-300 truncate">
                    Caption Theme: <strong className="text-white">{captionStyle}</strong> ·{' '}
                    <span className="text-indigo-300">{captionMeta.motionLabel}</span>
                    {hasUnsavedCaptionChange ? (
                      <span className="text-amber-300"> · Unsaved preview</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMotionReplayKey((k) => k + 1)}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <RotateCcw className="w-3 h-3" aria-hidden="true" />
                    Replay Motion
                  </button>
                </div>
                <div className="min-h-[68px] flex items-center justify-center overflow-hidden py-1">
                  <FancyCaptionOverlay
                    line={activePreviewCaption}
                    captionStyle={captionStyle}
                    fontFamily={fontFamily}
                    highlightColor={highlightColor}
                    motionTrigger={motionReplayKey}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <Palette className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
                Live preview: <strong className="text-slate-200">{videoTheme}</strong> ·{' '}
                <strong className="text-indigo-300">{captionStyle}</strong>
              </span>
              <span className="font-mono text-[11px] text-slate-500">
                Burns into MP4 export
              </span>
            </div>

            {showHtml5Player ? (
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
            ) : (
              <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                <span>YouTube segment window</span>
                <span className="font-mono text-indigo-300 tabular-nums">
                  {formatPreciseTimecode(startSec)} – {formatPreciseTimecode(endSec)} (
                  {Math.max(1, endSec - startSec).toFixed(1)}s)
                </span>
              </div>
            )}
          </div>

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
                      Math.min(
                        maxSourceDuration,
                        Math.max(startSec + 2, Number(e.target.value) || startSec + 2)
                      )
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

        <div className="lg:col-span-7 space-y-5">
          {/* Edit with AI: Fancy Captions & Video Theme */}
          <section className="p-5 rounded-xl bg-gradient-to-br from-[#131929] to-[#111520] border border-indigo-500/30 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-indigo-400" aria-hidden="true" />
                <h2 className="font-display text-sm font-semibold text-white">
                  Edit with AI — Fancy Captions &amp; Video Theme
                </h2>
              </div>
              <span className="text-[11px] text-indigo-300">
                Instant AI restyling + keyword highlights
              </span>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleAiEdit();
              }}
              className="flex flex-col sm:flex-row gap-2"
            >
              <input
                type="text"
                aria-label="AI editing prompt"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. Add Neon Glow fancy captions with cyan highlights and switch theme to Neon Cyber"
                className="flex-1 px-3 py-2 text-xs bg-[#090B10] border border-white/15 rounded-lg text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-400"
              />
              <button
                type="submit"
                disabled={aiEditing || saving}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 rounded-lg whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
              >
                {aiEditing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                {aiEditing ? 'Applying AI Edit...' : 'Apply AI Edit'}
              </button>
            </form>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-slate-400 mr-1">1-Click AI Styles:</span>
              {AI_EDIT_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  disabled={aiEditing || saving}
                  onClick={() => void handleAiEdit(preset.prompt)}
                  className="px-2.5 py-1 text-[11px] font-medium text-slate-200 bg-[#090B10] hover:bg-indigo-600/25 border border-white/10 hover:border-indigo-400/40 rounded-md whitespace-nowrap cursor-pointer disabled:opacity-50"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {aiSummary && (
              <div
                role="status"
                className="p-3 rounded-lg bg-emerald-950/35 border border-emerald-500/30 text-xs text-emerald-200"
              >
                {aiSummary}
              </div>
            )}
          </section>

          <section className="p-5 rounded-xl bg-[#111520] border border-white/10 space-y-5">
            <h2 className="font-display text-sm font-semibold text-white">
              Format, Video Theme, Caption Theme &amp; Audio
            </h2>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-slate-300 font-medium">
                  Caption Theme (CSS &amp; Motion Presets)
                </span>
                <span className="text-slate-400 text-[11px] truncate">
                  {captionMeta.description}
                </span>
              </div>
              <div
                role="group"
                aria-label="Caption Theme Presets"
                className="grid grid-cols-2 sm:grid-cols-3 gap-2"
              >
                {CAPTION_STYLES.map((preset) => {
                  const selected = captionStyle === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => handleSelectCaptionTheme(preset)}
                      className={`px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer ${
                        selected
                          ? 'border-indigo-400 bg-indigo-600/20 text-white'
                          : 'border-white/10 bg-[#090B10] text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/25"
                          style={{ backgroundColor: preset.swatchHex }}
                        />
                        <span className="text-xs font-semibold truncate">{preset.shortName}</span>
                      </div>
                      <p className="mt-0.5 pl-4 text-[11px] text-slate-400 truncate">
                        {preset.motionLabel}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300 font-medium">Video Theme</span>
                <span className="text-slate-400 text-[11px]">{themeMeta.description}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {VIDEO_THEMES.map((theme) => {
                  const selected = videoTheme === theme.id;
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setVideoTheme(theme.id)}
                      className={`px-2.5 py-2 rounded-lg border text-left flex items-center gap-2 text-xs transition-colors cursor-pointer ${
                        selected
                          ? 'border-indigo-400 bg-indigo-600/20 text-white font-semibold'
                          : 'border-white/10 bg-[#090B10] text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0 border border-white/20"
                        style={{ backgroundColor: theme.swatchHex }}
                      />
                      <span className="truncate">{theme.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
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

              <div>
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
                  onClick={() => {
                    setSelectedCaptionIdx(idx);
                    if (videoRef.current && showHtml5Player) {
                      videoRef.current.currentTime = line.start;
                      setCurrentTime(line.start);
                    }
                  }}
                  className={`p-2.5 rounded-lg bg-[#090B10] border flex flex-col sm:flex-row sm:items-center gap-2 cursor-pointer ${
                    selectedCaptionIdx === idx ? 'border-indigo-500/50' : 'border-white/10'
                  }`}
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
                        updateCaptionLine(idx, {
                          end: Math.max(0.2, Number(e.target.value) || 0.5),
                        })
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
                    onClick={(e) => {
                      e.stopPropagation();
                      setCaptions((prev) => prev.filter((_, i) => i !== idx));
                    }}
                    className="p-1.5 text-slate-400 hover:text-rose-400 cursor-pointer shrink-0 self-end sm:self-center"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="p-5 rounded-xl bg-[#111520] border border-white/10 space-y-3">
            <h2 className="font-display text-sm font-semibold text-white">Social Metadata</h2>
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
