import type { CaptionLine, ScoreBreakdown, TranscriptSegment } from '../shared/types';

export interface ParsedYouTubeUrl {
  valid: boolean;
  videoId: string;
  canonicalUrl: string;
  urlType: 'standard' | 'shortlink' | 'shorts' | 'live' | 'embed';
  error?: string;
}

const YOUTUBE_ID_REGEX = /^[a-zA-Z0-9_-]{11}$/;

export function parseYouTubeUrl(rawInput: string): ParsedYouTubeUrl {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      valid: false,
      videoId: '',
      canonicalUrl: '',
      urlType: 'standard',
      error: 'Enter a YouTube video URL to continue.',
    };
  }

  let url: URL;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    url = new URL(withProtocol);
  } catch {
    return {
      valid: false,
      videoId: '',
      canonicalUrl: '',
      urlType: 'standard',
      error: 'That does not look like a valid URL.',
    };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  const segments = url.pathname.split('/').filter(Boolean);

  let videoId = '';
  let urlType: ParsedYouTubeUrl['urlType'] = 'standard';

  if (host === 'youtu.be') {
    videoId = segments[0] ?? '';
    urlType = 'shortlink';
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (segments[0] === 'watch') {
      videoId = url.searchParams.get('v') ?? '';
      urlType = 'standard';
    } else if (segments[0] === 'shorts' && segments[1]) {
      videoId = segments[1];
      urlType = 'shorts';
    } else if (segments[0] === 'live' && segments[1]) {
      videoId = segments[1];
      urlType = 'live';
    } else if (segments[0] === 'embed' && segments[1]) {
      videoId = segments[1];
      urlType = 'embed';
    } else if (url.searchParams.get('v')) {
      videoId = url.searchParams.get('v') ?? '';
      urlType = 'standard';
    }
  } else {
    return {
      valid: false,
      videoId: '',
      canonicalUrl: '',
      urlType: 'standard',
      error: 'Please enter a youtube.com or youtu.be URL.',
    };
  }

  if (!YOUTUBE_ID_REGEX.test(videoId)) {
    return {
      valid: false,
      videoId: '',
      canonicalUrl: '',
      urlType,
      error: 'Could not find a valid 11-character YouTube video ID in that link.',
    };
  }

  return {
    valid: true,
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    urlType,
  };
}

export function formatTimecode(totalSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatPreciseTimecode(totalSeconds: number): string {
  const safe = Math.max(0, Number.isFinite(totalSeconds) ? totalSeconds : 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 75;
  return Math.max(1, Math.min(99, Math.round(value)));
}

export function computeEstimatedViralScore(breakdown: ScoreBreakdown): number {
  const weighted =
    clampScore(breakdown.hookStrength) * 0.28 +
    clampScore(breakdown.audienceRelevance) * 0.2 +
    clampScore(breakdown.emotionalImpact) * 0.18 +
    clampScore(breakdown.infoValue) * 0.18 +
    clampScore(breakdown.storyCompleteness) * 0.16;
  return clampScore(weighted);
}

export function splitTranscriptIntoCaptions(
  segments: TranscriptSegment[],
  clipStartSec: number,
  clipEndSec: number,
  maxWordsPerLine = 6
): CaptionLine[] {
  const lines: CaptionLine[] = [];
  const relevant = segments.filter(
    (seg) => seg.end > clipStartSec && seg.start < clipEndSec
  );

  for (const seg of relevant) {
    const segStart = Math.max(clipStartSec, seg.start) - clipStartSec;
    const segEnd = Math.min(clipEndSec, seg.end) - clipStartSec;
    const duration = Math.max(0.4, segEnd - segStart);
    const cleaned = seg.text.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;

    const words = cleaned.split(' ');
    const chunkCount = Math.max(1, Math.ceil(words.length / maxWordsPerLine));
    const chunkDuration = duration / chunkCount;

    for (let i = 0; i < chunkCount; i++) {
      const slice = words.slice(i * maxWordsPerLine, (i + 1) * maxWordsPerLine);
      const start = Number((segStart + i * chunkDuration).toFixed(2));
      const end = Number((segStart + (i + 1) * chunkDuration).toFixed(2));
      const highlightCandidates = slice.filter((w) => w.replace(/[^a-zA-Z0-9]/g, '').length >= 6);
      lines.push({
        id: `${seg.id}-${i}`,
        start,
        end: Math.max(start + 0.3, end),
        text: slice.join(' '),
        highlightWords: highlightCandidates.slice(0, 1),
        speaker: seg.speaker,
      });
    }
  }

  return lines;
}

export function buildYouTubeEmbedUrl(
  videoId: string,
  startSec: number,
  endSec: number,
  autoplay = false
): string {
  const safeId = YOUTUBE_ID_REGEX.test(videoId) ? videoId : '';
  if (!safeId) return '';
  const start = Math.max(0, Math.floor(Number.isFinite(startSec) ? startSec : 0));
  const end = Math.max(start + 1, Math.ceil(Number.isFinite(endSec) ? endSec : start + 15));
  const params = new URLSearchParams({
    start: String(start),
    end: String(end),
    rel: '0',
    modestbranding: '1',
    playsinline: '1',
  });
  if (autoplay) {
    params.set('autoplay', '1');
  }
  return `https://www.youtube.com/embed/${safeId}?${params.toString()}`;
}

function formatSrtTimestamp(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const totalMs = Math.round(safe * 1000);
  const hrs = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function formatCaptionsToSrt(captions: CaptionLine[]): string {
  const valid = (captions || []).filter((c) => c.text && c.text.trim().length > 0 && c.end > c.start);
  if (valid.length === 0) {
    return '';
  }
  return valid
    .map((line, idx) => {
      const start = formatSrtTimestamp(line.start);
      const end = formatSrtTimestamp(Math.max(line.start + 0.3, line.end));
      return `${idx + 1}\n${start} --> ${end}\n${line.text.trim()}\n`;
    })
    .join('\n');
}
