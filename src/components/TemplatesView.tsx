import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { ProjectConfig } from '../shared/types';

interface TemplatesViewProps {
  onApplyTemplate: (config: Partial<ProjectConfig>) => void;
}

const TEMPLATES: Array<{
  id: string;
  name: string;
  summary: string;
  specs: string;
  config: Partial<ProjectConfig>;
}> = [
  {
    id: 'podcast-vertical',
    name: 'Podcast Vertical Hooks',
    summary:
      'Designed for multi-speaker studio conversations. Prioritizes punchy 30-second vertical cuts with modern boxed subtitles and loudness normalization.',
    specs: '9:16 · 30s · Modern Captions · 3 Clips',
    config: {
      clipCount: 3,
      clipDuration: 30,
      aspectRatio: '9:16',
      captionStyle: 'Modern',
      contentStyle: 'Podcast',
      enhanceAudio: true,
      trimSilence: true,
      resolution: '1080p',
    },
  },
  {
    id: 'keynote-karaoke',
    name: 'Keynote Spotlight & Karaoke',
    summary:
      'Stage talk preset featuring word-by-word karaoke sweep captions, crisp 1080p vertical framing, and smooth intro/outro fade transitions.',
    specs: '9:16 · 45s · Karaoke Captions · 3 Clips',
    config: {
      clipCount: 3,
      clipDuration: 45,
      aspectRatio: '9:16',
      captionStyle: 'Karaoke',
      contentStyle: 'Educational',
      enhanceAudio: true,
      includeIntroOutro: true,
      resolution: '1080p',
    },
  },
  {
    id: 'linkedin-square',
    name: 'Executive Feed Square',
    summary:
      'Balanced 1:1 square format built for LinkedIn and X feeds. Uses minimal clean captions and business insight moment ranking.',
    specs: '1:1 · 60s · Minimal Captions · 3 Clips',
    config: {
      clipCount: 3,
      clipDuration: 60,
      aspectRatio: '1:1',
      captionStyle: 'Minimal',
      contentStyle: 'Business',
      enhanceAudio: true,
      resolution: '1080p',
    },
  },
  {
    id: 'high-energy-shorts',
    name: 'High-Retention Shorts Burst',
    summary:
      'Fast 15-second clips with bold uppercase captions and animated emphasis for motivational or entertainment highlights.',
    specs: '9:16 · 15s · Bold Captions · 5 Clips',
    config: {
      clipCount: 5,
      clipDuration: 15,
      aspectRatio: '9:16',
      captionStyle: 'Bold',
      contentStyle: 'Motivational',
      enhanceAudio: true,
      trimSilence: true,
      resolution: '1080p',
    },
  },
];

export function TemplatesView({ onApplyTemplate }: TemplatesViewProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-white">Clipping Templates</h1>
        <p className="mt-1 text-sm text-slate-400">
          Select a production preset to pre-configure aspect ratio, subtitle styling, and audio processing.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {TEMPLATES.map((tpl) => (
          <div
            key={tpl.id}
            className="p-6 rounded-xl bg-[#111520] border border-white/10 flex flex-col justify-between gap-5"
          >
            <div className="space-y-2">
              <p className="text-xs font-mono text-indigo-400 tabular-nums">{tpl.specs}</p>
              <h2 className="font-display text-lg font-semibold text-white">{tpl.name}</h2>
              <p className="text-sm text-slate-400 leading-relaxed">{tpl.summary}</p>
            </div>

            <button
              type="button"
              onClick={() => onApplyTemplate(tpl.config)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors self-start cursor-pointer"
            >
              Use Template
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
