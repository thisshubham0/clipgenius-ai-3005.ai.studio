import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowRight,
  Captions,
  ClipboardPaste,
  Crop,
  Film,
  Scissors,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { parseYouTubeUrl } from '../utils/youtube';

interface LandingPageProps {
  onEnterStudio: (prefillUrl?: string) => void;
  onOpenAuth: () => void;
  isAuthenticated: boolean;
}

export function LandingPage({
  onEnterStudio,
  onOpenAuth,
  isAuthenticated,
}: LandingPageProps) {
  const [heroUrl, setHeroUrl] = useState('');
  const [urlError, setUrlError] = useState('');

  const handlePaste = async () => {
    setUrlError('');
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setHeroUrl(text.trim());
      }
    } catch {
      setHeroUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    }
  };

  const handleAnalyzeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!heroUrl.trim()) {
      onEnterStudio();
      return;
    }
    const parsed = parseYouTubeUrl(heroUrl);
    if (!parsed.valid) {
      setUrlError(parsed.error || 'Enter a valid YouTube link.');
      return;
    }
    onEnterStudio(heroUrl.trim());
  };

  return (
    <div className="min-h-screen bg-[#090B10] text-slate-100">
      {/* Strict 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#090B10]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-8 px-6 py-4">
          <a
            href="#top"
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            ClipGenius AI
          </a>

          <nav
            aria-label="Primary navigation"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-300"
          >
            <a
              href="#workflow"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Workflow
            </a>
            <a
              href="#capabilities"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Capabilities
            </a>
            <a
              href="#formats"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Formats
            </a>
            <a
              href="#export"
              className="hover:text-white transition-colors whitespace-nowrap shrink-0"
            >
              Export
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => (isAuthenticated ? onEnterStudio() : onOpenAuth())}
              className="px-4 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isAuthenticated ? 'Open Studio' : 'Open Studio'}
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Hero Section */}
        <section className="mx-auto max-w-7xl px-6 pt-14 pb-16 lg:pt-20 lg:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="lg:col-span-7 flex flex-col justify-between space-y-8"
            >
              <div className="space-y-5">
                <p className="text-sm font-medium text-indigo-400">
                  AI Video Clipping · Speech-to-Text · Smart Framing
                </p>
                <h1
                  className="font-display font-bold tracking-tight text-white leading-[1.08]"
                  style={{
                    fontSize: 'clamp(2.25rem, 4vw, 3.65rem)',
                    textWrap: 'balance',
                  }}
                >
                  Turn long-form recordings into studio-grade short clips
                </h1>
                <p className="max-w-2xl text-base md:text-lg text-slate-300 leading-relaxed">
                  Analyze transcripts, surface the strongest hooks, crop cleanly into 9:16 vertical or 1:1 square frames, burn in synchronized captions, and render real MP4 files ready for publishing.
                </p>
              </div>

              <form onSubmit={handleAnalyzeSubmit} className="space-y-3">
                <label htmlFor="landing-youtube-url" className="sr-only">
                  YouTube Video URL
                </label>
                <div className="flex flex-col sm:flex-row gap-2.5 p-2 rounded-xl bg-[#111520] border border-white/10">
                  <input
                    id="landing-youtube-url"
                    type="text"
                    value={heroUrl}
                    onChange={(e) => {
                      setHeroUrl(e.target.value);
                      if (urlError) setUrlError('');
                    }}
                    placeholder="Paste a youtube.com, youtu.be, or Shorts link..."
                    className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handlePaste}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium text-slate-200 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <ClipboardPaste className="w-3.5 h-3.5" aria-hidden="true" />
                      Paste Link
                    </button>
                    <button
                      type="submit"
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Analyze Video
                      <ArrowRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                {urlError && (
                  <p role="alert" className="text-sm text-rose-400">
                    {urlError}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                  <span>Supports YouTube URLs &amp; local MP4/MOV uploads</span>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() => onEnterStudio()}
                    className="text-indigo-400 hover:text-indigo-300 font-medium underline underline-offset-4 cursor-pointer"
                  >
                    Launch workspace with authorized studio sample
                  </button>
                </div>
              </form>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.05 }}
              className="lg:col-span-5 relative rounded-xl overflow-hidden border border-white/10 bg-[#111520]"
            >
              <img
                src="/src/assets/images/hero_studio_preview_1794825184394.jpg"
                alt="Creator recording studio desk with camera and broadcast microphones"
                referrerPolicy="no-referrer"
                className="w-full h-72 lg:h-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent p-6">
                <p className="text-xs font-mono text-slate-300">
                  00:00 – 00:45 · 9:16 Vertical · Synchronized Captions
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  Real FFmpeg rendering paired with Gemini transcript intelligence
                </p>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Workflow Section */}
        <section id="workflow" className="border-t border-white/10 bg-[#0D1017]">
          <div className="mx-auto max-w-7xl px-6 py-16 lg:py-20">
            <div className="max-w-2xl mb-12">
              <h2 className="font-display text-2xl md:text-3xl font-bold text-white">
                End-to-end clipping pipeline
              </h2>
              <p className="mt-3 text-slate-300 text-base">
                Every stage runs transparently on real media files—from audio extraction and speech transcription to FFmpeg MP4 rendering.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                {
                  num: '01. Acquire & Inspect',
                  desc: 'Validate YouTube URLs for oEmbed metadata, or upload MP4/MOV footage directly with strict permission compliance.',
                },
                {
                  num: '02. Transcribe & Score',
                  desc: 'Extract mono audio tracks, generate punctuated speaker-aware transcripts, and rank hooks by estimated engagement potential.',
                },
                {
                  num: '03. Smart Frame & Caption',
                  desc: 'Convert widescreen video into 9:16, 1:1, or 16:9 with adjustable horizontal subject focus and 5 caption presets.',
                },
                {
                  num: '04. Edit & Render MP4',
                  desc: 'Fine-tune trim boundaries, rewrite caption lines, normalize loudness, and download crisp 720p or 1080p MP4 files.',
                },
              ].map((step) => (
                <div
                  key={step.num}
                  className="p-6 rounded-xl bg-[#111520] border border-white/10 space-y-2.5"
                >
                  <h3 className="font-display text-base font-semibold text-white">
                    {step.num}
                  </h3>
                  <p className="text-sm text-slate-400 leading-relaxed">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Capabilities Bento */}
        <section id="capabilities" className="border-t border-white/10">
          <div className="mx-auto max-w-7xl px-6 py-16 lg:py-20">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
              <div>
                <h2 className="font-display text-2xl md:text-3xl font-bold text-white">
                  Built for creators, podcasters, and teams
                </h2>
                <p className="mt-2 text-slate-400 text-base">
                  Focused editing tools without bloated timeline clutter.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onEnterStudio()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer self-start md:self-auto"
              >
                Explore Studio Workspace
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 p-6 rounded-xl bg-[#111520] border border-white/10 flex flex-col justify-between gap-6">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-indigo-400 text-sm font-medium">
                    <Sparkles className="w-4 h-4" aria-hidden="true" />
                    <span>AI Moment &amp; Hook Detection</span>
                  </div>
                  <h3 className="font-display text-xl font-semibold text-white">
                    Story-aware timestamps instead of blind interval cuts
                  </h3>
                  <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
                    ClipGenius reads the complete spoken transcript to detect complete arguments, stories, and high-retention opening hooks, paired with a transparent 5-factor engagement estimate.
                  </p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-white/10 text-xs">
                  <div>
                    <p className="text-slate-400">Hook Strength</p>
                    <p className="mt-1 font-mono text-base font-semibold text-white tabular-nums">28% weight</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Relevance</p>
                    <p className="mt-1 font-mono text-base font-semibold text-white tabular-nums">20% weight</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Emotional Pull</p>
                    <p className="mt-1 font-mono text-base font-semibold text-white tabular-nums">18% weight</p>
                  </div>
                  <div>
                    <p className="text-slate-400">Completeness</p>
                    <p className="mt-1 font-mono text-base font-semibold text-white tabular-nums">16% weight</p>
                  </div>
                </div>
              </div>

              <div className="p-6 rounded-xl bg-[#111520] border border-white/10 space-y-3">
                <div className="flex items-center gap-2 text-sky-400 text-sm font-medium">
                  <Captions className="w-4 h-4" aria-hidden="true" />
                  <span>Burned-In Subtitles</span>
                </div>
                <h3 className="font-display text-lg font-semibold text-white">
                  5 ASS Caption Presets
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Minimal, Animated, Bold, Karaoke word-sweep, and Modern pill-free subtitles with editable timing and keyword highlight colors.
                </p>
              </div>

              <div id="formats" className="p-6 rounded-xl bg-[#111520] border border-white/10 space-y-3">
                <div className="flex items-center gap-2 text-sky-400 text-sm font-medium">
                  <Crop className="w-4 h-4" aria-hidden="true" />
                  <span>Smart Cropping</span>
                </div>
                <h3 className="font-display text-lg font-semibold text-white">
                  9:16, 1:1, and 16:9 Framing
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Adjust horizontal speaker crop focus smoothly before rendering so active speakers stay centered in vertical feeds.
                </p>
              </div>

              <div className="p-6 rounded-xl bg-[#111520] border border-white/10 space-y-3">
                <div className="flex items-center gap-2 text-indigo-400 text-sm font-medium">
                  <Sliders className="w-4 h-4" aria-hidden="true" />
                  <span>Interactive Editor</span>
                </div>
                <h3 className="font-display text-lg font-semibold text-white">
                  Trim, Rewrite &amp; Re-Render
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Fine-tune clip start and end seconds, edit any transcript subtitle line, and toggle loudness normalization or silence trimming.
                </p>
              </div>

              <div id="export" className="p-6 rounded-xl bg-[#111520] border border-white/10 space-y-3">
                <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                  <Film className="w-4 h-4" aria-hidden="true" />
                  <span>Production MP4 Export</span>
                </div>
                <h3 className="font-display text-lg font-semibold text-white">
                  720p &amp; 1080p Downloads
                </h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Fast-start H.264/AAC MP4 files saved to your Download Center with complete project and export history synced to PostgreSQL.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-[#07090D]">
        <div className="mx-auto max-w-7xl px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-2 text-slate-300 font-medium">
            <Scissors className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
            <span>ClipGenius AI</span>
          </div>
          <p>
            Respects creator copyright and platform terms. Only authorized media and user uploads are processed.
          </p>
        </div>
      </footer>
    </div>
  );
}
