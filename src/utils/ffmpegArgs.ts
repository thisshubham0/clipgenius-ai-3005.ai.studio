import type {
  AspectRatio,
  CaptionLine,
  CaptionStyle,
  ExportResolution,
} from '../shared/types';

export interface TargetDimensions {
  width: number;
  height: number;
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

  const isBold = options.captionStyle === 'Bold' || options.captionStyle === 'Karaoke';
  const isMinimal = options.captionStyle === 'Minimal';
  const isModern = options.captionStyle === 'Modern';
  const fontSize = options.aspectRatio === '9:16'
    ? Math.round(height * (isMinimal ? 0.032 : 0.038))
    : Math.round(height * (isMinimal ? 0.042 : 0.052));
  const marginV = options.aspectRatio === '9:16' ? Math.round(height * 0.16) : Math.round(height * 0.1);
  const borderStyle = isModern ? 3 : 1;
  const outline = isMinimal ? 1.5 : isModern ? 8 : 3.5;
  const shadow = isMinimal ? 0 : 1.5;
  const backColour = isModern ? '&H99090B10' : '&H80000000';
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
    `Style: Default,${options.fontFamily || 'Plus Jakarta Sans'},${fontSize},${primaryColour},${accentAss},&H00090B10,${backColour},${isBold ? -1 : 0},0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},2,48,48,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const events = options.captions
    .filter((c) => c.text.trim().length > 0 && c.end > c.start)
    .map((line) => {
      const startStr = formatAssTime(line.start);
      const endStr = formatAssTime(line.end);
      let renderedText = escapeAssText(line.text.trim());

      if (options.captionStyle === 'Karaoke') {
        const words = line.text.trim().split(/\s+/);
        const totalCs = Math.max(10, Math.round((line.end - line.start) * 100));
        const perWordCs = Math.max(5, Math.floor(totalCs / Math.max(1, words.length)));
        renderedText = words
          .map((word) => `{\\kf${perWordCs}}${escapeAssText(word)}`)
          .join(' ');
      } else if (options.captionStyle === 'Animated') {
        renderedText = `{\\fscx92\\fscy92\\t(0,110,\\fscx103\\fscy103)\\t(110,190,\\fscx100\\fscy100)}${applyKeywordHighlight(line.text, line.highlightWords, accentAss)}`;
      } else {
        renderedText = applyKeywordHighlight(line.text, line.highlightWords, accentAss);
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
  assFilePath?: string;
}): string {
  const { width, height } = getTargetDimensions(params.aspectRatio, params.resolution);
  const clampedX = Math.max(0, Math.min(1, Number.isFinite(params.cropX) ? params.cropX : 0.5));
  const targetRatioExpr = `${width}/${height}`;

  // Crop from source preserving aspect ratio without stretching, centered around cropX
  const cropFilter = `crop='min(iw,ih*${targetRatioExpr})':'min(ih,iw/(${targetRatioExpr}))':'(iw-ow)*${clampedX.toFixed(3)}':'(ih-oh)/2'`;
  const scaleFilter = `scale=${width}:${height}:flags=lanczos,setsar=1`;

  const filters = [cropFilter, scaleFilter];
  if (params.assFilePath) {
    const escapedAss = params.assFilePath
      .replace(/\\/g, '/')
      .replace(/:/g, '\\:')
      .replace(/'/g, "\\'");
    filters.push(`ass='${escapedAss}'`);
  }

  return filters.join(',');
}
