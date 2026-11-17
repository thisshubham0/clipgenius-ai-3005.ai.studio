import type { CaptionStyle, VideoTheme } from '../shared/types';

export interface VideoThemeMeta {
  id: VideoTheme;
  label: string;
  description: string;
  swatchHex: string;
  cssFilter: string;
  overlayClass: string;
  ffmpegFilter: string;
}

export type CaptionMotionKind =
  | 'fade'
  | 'glow-pop'
  | 'slide-up'
  | 'bounce'
  | 'scale-pop'
  | 'type-reveal'
  | 'glitch-snap'
  | 'sweep';

export interface CaptionStyleMeta {
  id: CaptionStyle;
  label: string;
  shortName: string;
  description: string;
  motionLabel: string;
  motionKind: CaptionMotionKind;
  isFancy: boolean;
  recommendedFont: string;
  recommendedHighlight: string;
  swatchHex: string;
  cssBoxClass: string;
}

export const VIDEO_THEMES: VideoThemeMeta[] = [
  {
    id: 'Original',
    label: 'Original',
    description: 'Natural untouched camera color & framing',
    swatchHex: '#64748B',
    cssFilter: 'none',
    overlayClass: '',
    ffmpegFilter: '',
  },
  {
    id: 'Cinematic',
    label: 'Cinematic',
    description: 'Deep teal shadows, warm skin highlights & subtle film vignette',
    swatchHex: '#0EA5E9',
    cssFilter: 'contrast(1.12) brightness(0.96) saturate(0.92)',
    overlayClass: 'bg-gradient-to-t from-slate-950/45 via-transparent to-cyan-950/20',
    ffmpegFilter:
      'eq=contrast=1.12:brightness=-0.02:saturation=0.92,colorbalance=rs=-0.04:gs=0.01:bs=0.06:rh=0.05:gh=0.02:bh=-0.04,vignette=PI/5',
  },
  {
    id: 'Neon Cyber',
    label: 'Neon Cyber',
    description: 'Electric magenta & cyan contrast pop for high-energy Reels',
    swatchHex: '#EC4899',
    cssFilter: 'contrast(1.22) saturate(1.48) hue-rotate(-10deg)',
    overlayClass: 'bg-gradient-to-tr from-fuchsia-950/35 via-transparent to-cyan-900/25',
    ffmpegFilter:
      'eq=contrast=1.22:saturation=1.45:brightness=0.02,colorbalance=rs=-0.06:gs=-0.02:bs=0.14:rh=0.10:gh=-0.04:bh=0.12,vignette=PI/6',
  },
  {
    id: 'Warm Sunset',
    label: 'Warm Sunset',
    description: 'Golden amber warmth for lifestyle, podcast & storytelling',
    swatchHex: '#F59E0B',
    cssFilter: 'contrast(1.08) saturate(1.25) sepia(0.18)',
    overlayClass: 'bg-gradient-to-t from-amber-950/30 via-transparent to-orange-500/10',
    ffmpegFilter:
      'eq=contrast=1.08:saturation=1.24:brightness=0.03,colorbalance=rs=0.09:gs=0.03:bs=-0.08:rh=0.10:gh=0.04:bh=-0.06',
  },
  {
    id: 'Noir Monochrome',
    label: 'Noir Monochrome',
    description: 'Crisp high-contrast black & white documentary look',
    swatchHex: '#E2E8F0',
    cssFilter: 'grayscale(1) contrast(1.30) brightness(0.95)',
    overlayClass: 'bg-gradient-to-b from-black/25 via-transparent to-black/45',
    ffmpegFilter: 'hue=s=0,eq=contrast=1.28:brightness=-0.03,vignette=PI/4.5',
  },
  {
    id: 'Vibrant Pop',
    label: 'Vibrant Pop',
    description: 'Punchy color saturation & bright clarity for Shorts feeds',
    swatchHex: '#22C55E',
    cssFilter: 'contrast(1.15) saturate(1.38) brightness(1.03)',
    overlayClass: '',
    ffmpegFilter: 'eq=contrast=1.15:saturation=1.35:brightness=0.03',
  },
  {
    id: 'Studio Clean',
    label: 'Studio Clean',
    description: 'Balanced key-light lift & crisp detail sharpening',
    swatchHex: '#818CF8',
    cssFilter: 'contrast(1.06) saturate(1.08) brightness(1.05)',
    overlayClass: '',
    ffmpegFilter: 'eq=contrast=1.06:saturation=1.08:brightness=0.04,unsharp=5:5:0.45:5:5:0.0',
  },
];

export const CAPTION_STYLES: CaptionStyleMeta[] = [
  {
    id: 'Minimal',
    label: 'Minimal',
    shortName: 'Minimal',
    description: 'Subtle clean subtitle with soft fade transition',
    motionLabel: 'Soft Fade',
    motionKind: 'fade',
    isFancy: false,
    recommendedFont: 'DM Sans',
    recommendedHighlight: '#38BDF8',
    swatchHex: '#94A3B8',
    cssBoxClass: 'px-3 py-1 rounded bg-black/55 font-medium tracking-normal',
  },
  {
    id: 'Neon Glow',
    label: 'Neon Glow (Fancy)',
    shortName: 'Neon Glow',
    description: 'Glowing accent outline with energetic spring pop',
    motionLabel: 'Glow Pop',
    motionKind: 'glow-pop',
    isFancy: true,
    recommendedFont: 'Plus Jakarta Sans',
    recommendedHighlight: '#38BDF8',
    swatchHex: '#22D3EE',
    cssBoxClass: 'px-3.5 py-2 rounded-lg bg-black/60 backdrop-blur-sm border border-white/20 font-extrabold tracking-wide',
  },
  {
    id: 'Professional',
    label: 'Professional',
    shortName: 'Professional',
    description: 'Broadcast-grade slate lower-third bar with crisp slide-up reveal',
    motionLabel: 'Slide Up',
    motionKind: 'slide-up',
    isFancy: true,
    recommendedFont: 'Plus Jakarta Sans',
    recommendedHighlight: '#38BDF8',
    swatchHex: '#60A5FA',
    cssBoxClass: 'px-4 py-2 rounded-md bg-slate-950/90 border border-slate-400/30 shadow-md font-semibold tracking-tight',
  },
  {
    id: 'Gradient Box',
    label: 'Gradient Box (Fancy)',
    shortName: 'Gradient Box',
    description: 'Frosted dark gradient capsule with accent keyword highlight',
    motionLabel: 'Slide Up',
    motionKind: 'slide-up',
    isFancy: true,
    recommendedFont: 'Plus Jakarta Sans',
    recommendedHighlight: '#A78BFA',
    swatchHex: '#A78BFA',
    cssBoxClass: 'px-4 py-2 rounded-lg bg-gradient-to-r from-[#090B10]/90 via-indigo-950/90 to-[#090B10]/90 border border-white/20 backdrop-blur-md font-bold shadow-lg',
  },
  {
    id: 'Comic Pop',
    label: 'Comic Pop (Fancy)',
    shortName: 'Comic Pop',
    description: 'Bold uppercase kinetic bounce with crisp outline stroke',
    motionLabel: 'Bounce Pop',
    motionKind: 'bounce',
    isFancy: true,
    recommendedFont: 'Plus Jakarta Sans',
    recommendedHighlight: '#FBBF24',
    swatchHex: '#FBBF24',
    cssBoxClass: 'px-3 py-1.5 -rotate-1 font-black uppercase tracking-wider',
  },
  {
    id: 'Typewriter',
    label: 'Typewriter (Fancy)',
    shortName: 'Typewriter',
    description: 'Crisp monospace cue with sequential reveal feel',
    motionLabel: 'Type Reveal',
    motionKind: 'type-reveal',
    isFancy: true,
    recommendedFont: 'JetBrains Mono',
    recommendedHighlight: '#34D399',
    swatchHex: '#34D399',
    cssBoxClass: 'px-3.5 py-1.5 rounded bg-[#090B10]/95 border border-white/15 font-mono font-semibold tracking-tight',
  },
  {
    id: 'Glitch Kinetic',
    label: 'Glitch Kinetic (Fancy)',
    shortName: 'Glitch Kinetic',
    description: 'High-energy kinetic stretch with dual-tone chromatic offset',
    motionLabel: 'Glitch Snap',
    motionKind: 'glitch-snap',
    isFancy: true,
    recommendedFont: 'Plus Jakarta Sans',
    recommendedHighlight: '#FB7185',
    swatchHex: '#FB7185',
    cssBoxClass: 'px-3 py-1.5 font-black italic uppercase tracking-wide',
  },
  {
    id: 'Modern',
    label: 'Modern',
    shortName: 'Modern',
    description: 'Clean rounded dark backdrop behind crisp white text',
    motionLabel: 'Smooth Fade',
    motionKind: 'fade',
    isFancy: false,
    recommendedFont: 'Plus Jakarta Sans',
    recommendedHighlight: '#38BDF8',
    swatchHex: '#818CF8',
    cssBoxClass: 'px-3.5 py-1.5 rounded-md bg-black/80 font-semibold',
  },
  {
    id: 'Animated',
    label: 'Animated',
    shortName: 'Animated',
    description: 'Dynamic scale-in emphasis on highlighted keywords',
    motionLabel: 'Scale Pop',
    motionKind: 'scale-pop',
    isFancy: false,
    recommendedFont: 'Plus Jakarta Sans',
    recommendedHighlight: '#38BDF8',
    swatchHex: '#38BDF8',
    cssBoxClass: 'px-3 py-1 rounded bg-black/55 font-semibold',
  },
  {
    id: 'Bold',
    label: 'Bold',
    shortName: 'Bold',
    description: 'High-impact uppercase stroke captions',
    motionLabel: 'Scale Pop',
    motionKind: 'scale-pop',
    isFancy: false,
    recommendedFont: 'Plus Jakarta Sans',
    recommendedHighlight: '#FBBF24',
    swatchHex: '#F59E0B',
    cssBoxClass: 'px-2 py-1 font-extrabold uppercase tracking-wide',
  },
  {
    id: 'Karaoke',
    label: 'Karaoke',
    shortName: 'Karaoke',
    description: 'Word-by-word timed color fill sweep',
    motionLabel: 'Color Sweep',
    motionKind: 'sweep',
    isFancy: false,
    recommendedFont: 'Plus Jakarta Sans',
    recommendedHighlight: '#34D399',
    swatchHex: '#10B981',
    cssBoxClass: 'px-3 py-1 rounded bg-black/55 font-bold',
  },
];

export const AI_EDIT_PRESETS: Array<{ label: string; prompt: string }> = [
  {
    label: 'Neon Viral Reels',
    prompt:
      'Change the video theme to Neon Cyber, add Neon Glow fancy captions with electric cyan highlights, and punch up key words.',
  },
  {
    label: 'Executive Broadcast',
    prompt:
      'Set the video theme to Studio Clean and apply Professional captions with clean slate lower-third contrast and crisp keyword emphasis.',
  },
  {
    label: 'Cinematic Film',
    prompt:
      'Set the video theme to Cinematic and apply Gradient Box fancy captions with crisp highlighted key phrases.',
  },
  {
    label: 'Comic High-Energy',
    prompt:
      'Apply Comic Pop fancy captions with bright amber highlights and Vibrant Pop video theme.',
  },
  {
    label: 'Noir Documentary',
    prompt:
      'Change the video theme to Noir Monochrome with Typewriter captions and sharp documentary pacing.',
  },
];

const VALID_THEMES = new Set<string>(VIDEO_THEMES.map((t) => t.id));
const VALID_CAPTION_STYLES = new Set<string>(CAPTION_STYLES.map((c) => c.id));

export function normalizeVideoTheme(input?: string): VideoTheme {
  if (input && VALID_THEMES.has(input)) {
    return input as VideoTheme;
  }
  return 'Original';
}

export function normalizeCaptionStyle(input?: string): CaptionStyle {
  if (input && VALID_CAPTION_STYLES.has(input)) {
    return input as CaptionStyle;
  }
  return 'Modern';
}

export function getVideoThemeMeta(theme?: VideoTheme | string): VideoThemeMeta {
  const normalized = normalizeVideoTheme(theme);
  return VIDEO_THEMES.find((t) => t.id === normalized) ?? VIDEO_THEMES[0];
}

export function getCaptionStyleMeta(style?: CaptionStyle | string): CaptionStyleMeta {
  const normalized = normalizeCaptionStyle(style);
  return CAPTION_STYLES.find((c) => c.id === normalized) ?? CAPTION_STYLES[0];
}
