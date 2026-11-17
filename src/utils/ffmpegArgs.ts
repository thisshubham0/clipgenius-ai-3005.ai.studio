import type {
  AspectRatio,
  CaptionLine,
  CaptionStyle,
  ExportResolution,
  VideoTheme,
} from '../shared/types';
import { getVideoThemeMeta } from './videoStyles';

export interface TargetDimensions {
  width: number;
  height: number;
}

export interface AudioChunkWindow {
  index: number;
  startSec: number;
  durationSec: number;
}

export function resolveSystemFontName(fontFamily?: string): string {
  const normalized = (fontFamily || '').trim().toLowerCase();
  if (normalized.includes('jetbrains')) return 'JetBrains Mono';
  if (normalized.includes('dejavu')) return 'DejaVu Sans';
  if (normalized.includes('dm sans') || normalized.includes('arial') || normalized.includes('liberation')) {
    return 'Liberation Sans';
  }
  return 'Noto Sans';
}

export function computeAudioChunkWindows(
  totalDurationSec: number,
  chunkDurationSec = 720
): AudioChunkWindow[] {
  const safeTotal = Math.max(1, Number.isFinite(totalDurationSec) ? totalDurationSec : 1);
  const safeChunk = Math.max(30, Number.isFinite(chunkDurationSec) ? chunkDurationSec : 720);
  const windows: AudioChunkWindow[] = [];

  let offset = 0;
  let index = 0;
  while (offset < safeTotal - 0.1 || windows.length === 0) {
    const remaining = safeTotal - offset;
    const durationSec = Math.min(safeChunk, Math.max(1, remaining));
    windows.push({
      index,
      startSec: Number(offset.toFixed(2)),
      durationSec: Number(durationSec.toFixed(2)),
    });
    offset += durationSec;
    index += 1;
    if (remaining <= safeChunk) break;
  }

  return windows;
}

export function clampClipWindow(
  rawStartSec: number,
  rawEndSec: number,
  sourceDurationSec: number,
  minDurationSec = 1.5
): { startSec: number; endSec: number; durationSec: number } {
  const safeSourceDuration = Math.max(1.5, Number.isFinite(sourceDurationSec) ? sourceDurationSec : 15);
  const effectiveMin = Math.min(safeSourceDuration, Math.max(1, minDurationSec));

  let startSec = Number.isFinite(rawStartSec) ? rawStartSec : 0;
  let endSec = Number.isFinite(rawEndSec) ? rawEndSec : startSec + effectiveMin;

  if (endSec < startSec) {
    [startSec, endSec] = [endSec, startSec];
  }

  startSec = Math.max(0, Math.min(safeSourceDuration - effectiveMin, startSec));
  endSec = Math.min(safeSourceDuration, Math.max(startSec + effectiveMin, endSec));

  return {
    startSec: Number(startSec.toFixed(2)),
    endSec: Number(endSec.toFixed(2)),
    durationSec: Number(Math.max(effectiveMin, endSec - startSec).toFixed(2)),
  };
}

export function getTargetDimensions(
  aspectRatio: AspectRatio,
  resolution: ExportResolution
): TargetDimensions {
  const is1080 = resolution === '1080p';
  switch (aspectRatio) {
    case '9:16':
      return is1080 ? { width: 1080, height: 1920 } : { width: 720, height: 1280 };
    case '1:1':
      return is1080 ? { width: 1080, height: 1080 } : { width: 720, height: 720 };
    case '16:9':
    default:
      return is1080 ? { width: 1920, height: 1080 } : { width: 1280, height: 720 };
  }
}

export function formatAssTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const cs = Math.floor((safe % 1) * 100);
  return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function hexToAssBgr(hexColor: string): string {
  const cleaned = hexColor.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return '&H00F8BD38';
  }
  const r = cleaned.slice(0, 2);
  const g = cleaned.slice(2, 4);
  const b = cleaned.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

function escapeAssText(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

export interface AssBuildOptions {
  captions: CaptionLine[];
  aspectRatio: AspectRatio;
  resolution: ExportResolution;
  captionStyle: CaptionStyle;
  fontFamily: string;
  highlightColor: string;
}

export function buildAssSubtitles(options: AssBuildOptions): string {
  const { width, height } = getTargetDimensions(options.aspectRatio, options.resolution);
  const accentAss = hexToAssBgr(options.highlightColor);
  const isTypewriter = options.captionStyle === 'Typewriter';
  const systemFont = isTypewriter ? 'JetBrains Mono' : resolveSystemFontName(options.fontFamily);

  const isBold =
    options.captionStyle === 'Bold' ||
    options.captionStyle === 'Karaoke' ||
    options.captionStyle === 'Neon Glow' ||
    options.captionStyle === 'Comic Pop' ||
    options.captionStyle === 'Glitch Kinetic' ||
    options.captionStyle === 'Gradient Box' ||
    options.captionStyle === 'Professional';
  const isMinimal = options.captionStyle === 'Minimal';
  const isProfessional = options.captionStyle === 'Professional';
  const isBoxed =
    options.captionStyle === 'Modern' ||
    options.captionStyle === 'Gradient Box' ||
    isProfessional;
  const isNeonGlow = options.captionStyle === 'Neon Glow';
  const isComicPop = options.captionStyle === 'Comic Pop';

  const baseScale = isMinimal ? 0.032 : isProfessional ? 0.035 : isComicPop || isNeonGlow ? 0.042 : 0.038;
  const landscapeScale = isMinimal ? 0.042 : isProfessional ? 0.046 : isComicPop || isNeonGlow ? 0.056 : 0.052;
  const fontSize =
    options.aspectRatio === '9:16'
      ? Math.round(height * baseScale)
      : Math.round(height * landscapeScale);
  const marginV = options.aspectRatio === '9:16' ? Math.round(height * 0.16) : Math.round(height * 0.1);
  const borderStyle = isBoxed ? 3 : 1;
  const outline = isMinimal ? 1.5 : isProfessional ? 8 : isBoxed ? 9 : isComicPop ? 5.5 : isNeonGlow ? 4 : 3.5;
  const shadow = isMinimal ? 0 : isComicPop ? 3 : isNeonGlow ? 2.5 : isProfessional ? 1 : 1.5;
  const outlineColour = isNeonGlow ? accentAss : isProfessional ? '&H001E293B' : '&H00090B10';
  const backColour =
    options.captionStyle === 'Gradient Box'
      ? '&HBF12182B'
      : isProfessional
        ? '&HCC0F172A'
        : options.captionStyle === 'Modern'
          ? '&H99090B10'
          : '&H80000000';
  const primaryColour = '&H00FFFFFF';

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Default,${systemFont},${fontSize},${primaryColour},${accentAss},${outlineColour},${backColour},${isBold ? -1 : 0},0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},2,48,48,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events = options.captions
    .filter((c) => c.text.trim().length > 0 && c.end > c.start)
    .map((line) => {
      const startStr = formatAssTime(line.start);
      const endStr = formatAssTime(line.end);
      const rawText = isComicPop || options.captionStyle === 'Bold' ? line.text.trim().toUpperCase() : line.text.trim();
      let renderedText = escapeAssText(rawText);

      if (options.captionStyle === 'Karaoke') {
        const words = rawText.split(/\s+/);
        const totalCs = Math.max(10, Math.round((line.end - line.start) * 100));
        const perWordCs = Math.max(5, Math.floor(totalCs / Math.max(1, words.length)));
        renderedText = words
          .map((word) => `{\\kf${perWordCs}}${escapeAssText(word)}`)
          .join(' ');
      } else if (options.captionStyle === 'Animated') {
        renderedText = `{\\fscx92\\fscy92\\t(0,110,\\fscx103\\fscy103)\\t(110,190,\\fscx100\\fscy100)}${applyKeywordHighlight(rawText, line.highlightWords, accentAss)}`;
      } else if (options.captionStyle === 'Neon Glow') {
        renderedText = `{\\blur2.5\\fscx88\\fscy88\\t(0,130,\\fscx105\\fscy105)\\t(130,220,\\fscx100\\fscy100)}${applyKeywordHighlight(rawText, line.highlightWords, accentAss)}`;
      } else if (options.captionStyle === 'Professional') {
        renderedText = `{\\fad(120,80)}${applyKeywordHighlight(rawText, line.highlightWords, accentAss)}`;
      } else if (options.captionStyle === 'Comic Pop') {
        renderedText = `{\\frz-2\\fscx84\\fscy84\\t(0,110,\\fscx108\\fscy108\\frz1)\\t(110,200,\\fscx100\\fscy100\\frz0)}${applyKeywordHighlight(rawText, line.highlightWords, accentAss)}`;
      } else if (options.captionStyle === 'Gradient Box') {
        renderedText = `{\\fad(90,70)}${applyKeywordHighlight(rawText, line.highlightWords, accentAss)}`;
      } else if (options.captionStyle === 'Glitch Kinetic') {
        renderedText = `{\\fscx114\\fscy88\\t(0,85,\\fscx96\\fscy105)\\t(85,170,\\fscx100\\fscy100)}${applyKeywordHighlight(rawText, line.highlightWords, accentAss)}`;
      } else if (options.captionStyle === 'Typewriter') {
        const words = rawText.split(/\s+/);
        const totalMs = Math.max(250, Math.round((line.end - line.start) * 850));
        const stepMs = Math.max(40, Math.floor(totalMs / Math.max(1, words.length)));
        renderedText = words
          .map((word, wi) => {
            const tStart = wi * stepMs;
            const tEnd = tStart + 60;
            return `{\\alpha&HFF&\\t(${tStart},${tEnd},\\alpha&H00&)}${escapeAssText(word)}`;
          })
          .join(' ');
      } else {
        renderedText = applyKeywordHighlight(rawText, line.highlightWords, accentAss);
      }

      return `Dialogue: 0,${startStr},${endStr},Default,,0,0,0,,${renderedText}`;
    });

  return [...header, ...events, ''].join('\n');
}

function applyKeywordHighlight(
  text: string,
  highlightWords: string[] | undefined,
  accentAss: string
): string {
  if (!highlightWords || highlightWords.length === 0) {
    return escapeAssText(text.trim());
  }
  const targetSet = new Set(highlightWords.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, '')));
  return text
    .trim()
    .split(/\s+/)
    .map((word) => {
      const normalized = word.toLowerCase().replace(/[^a-z0-9]/g, '');
      const escaped = escapeAssText(word);
      if (normalized && targetSet.has(normalized)) {
        return `{\\c${accentAss}\\b1}${escaped}{\\c&H00FFFFFF&\\b0}`;
      }
      return escaped;
    })
    .join(' ');
}

export function buildVideoFilterGraph(params: {
  aspectRatio: AspectRatio;
  resolution: ExportResolution;
  cropX: number; // 0.0 (left) to 1.0 (right)
  videoTheme?: VideoTheme;
  assFilePath?: string;
}): string {
  const { width, height } = getTargetDimensions(params.aspectRatio, params.resolution);
  const clampedX = Math.max(0, Math.min(1, Number.isFinite(params.cropX) ? params.cropX : 0.5));
  const targetRatioExpr = `${width}/${height}`;

  // Crop from source preserving aspect ratio without stretching, centered around cropX
  const cropFilter = `crop='min(iw,ih*${targetRatioExpr})':'min(ih,iw/(${targetRatioExpr}))':'(iw-ow)*${clampedX.toFixed(3)}':'(ih-oh)/2'`;
  const scaleFilter = `scale=${width}:${height}:flags=bicubic,setsar=1`;

  const filters = [cropFilter, scaleFilter];

  const themeMeta = getVideoThemeMeta(params.videoTheme);
  if (themeMeta.ffmpegFilter) {
    filters.push(themeMeta.ffmpegFilter);
  }

  if (params.assFilePath) {
    const escapedAss = params.assFilePath
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:')
      .replace(/'/g, "\\'");
    filters.push(`ass='${escapedAss}'`);
  }

  return filters.join(',');
}
