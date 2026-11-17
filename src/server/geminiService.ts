import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  CaptionLine,
  ProjectConfig,
  ScoreBreakdown,
  TranscriptSegment,
} from '../shared/types.ts';
import { clampClipWindow } from '../utils/ffmpegArgs.ts';
import {
  isRetryableGeminiError,
  parseGeminiJson,
  withExponentialBackoff,
} from '../utils/pipelineResilience.ts';
import {
  computeEstimatedViralScore,
  splitTranscriptIntoCaptions,
} from '../utils/youtube.ts';

const PRIMARY_MODEL = 'gemini-4-hydrogen';
const FALLBACK_MODEL = 'gemini-3.1-flash-lite';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please add your Gemini API key in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatGeminiError(error: unknown): Error {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return new Error(
      'Gemini API authentication failed. Please verify your GEMINI_API_KEY in Settings > Secrets.'
    );
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return new Error(
      'Gemini API rate limit reached across retries. Please wait a moment and retry.'
    );
  }
  if (raw.includes('503') || raw.includes('UNAVAILABLE') || raw.toLowerCase().includes('high demand')) {
    return new Error(
      'Gemini AI service is temporarily experiencing high demand. Automatic retries exhausted — please click Retry in a few seconds.'
    );
  }
  return new Error(`AI analysis error: ${raw}`);
}

async function generateWithResilience(
  taskLabel: string,
  buildRequest: (model: string, thinkingLevel: ThinkingLevel) => Parameters<GoogleGenAI['models']['generateContent']>[0],
  options?: { defaultThinkingLevel?: ThinkingLevel; perAttemptTimeoutMs?: number; maxPrimaryAttempts?: number }
) {
  const ai = getGeminiClient();
  const startedAt = Date.now();
  const defaultThinking = options?.defaultThinkingLevel ?? ThinkingLevel.LOW;
  const maxPrimaryAttempts = options?.maxPrimaryAttempts ?? 3;

  const callWithOptionalTimeout = async (
    req: Parameters<GoogleGenAI['models']['generateContent']>[0]
  ) => {
    const timeoutMs = options?.perAttemptTimeoutMs;
    if (!timeoutMs) {
      return ai.models.generateContent(req);
    }
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        ai.models.generateContent(req),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('503 UNAVAILABLE: Gemini request timed out')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  try {
    return await withExponentialBackoff(
      async (attempt) => {
        const res = await callWithOptionalTimeout(buildRequest(PRIMARY_MODEL, defaultThinking));
        console.info(`[Gemini] ${taskLabel} succeeded on ${PRIMARY_MODEL} attempt=${attempt} in ${Date.now() - startedAt}ms`);
        return res;
      },
      {
        maxAttempts: maxPrimaryAttempts,
        baseDelayMs: 900,
        shouldRetry: isRetryableGeminiError,
        onRetry: (err, attempt, delayMs) => {
          console.warn(
            `[Gemini] ${taskLabel} transient failure on ${PRIMARY_MODEL} attempt=${attempt}, retrying in ${delayMs}ms:`,
            err instanceof Error ? err.message : String(err)
          );
        },
      }
    );
  } catch (primaryErr) {
    if (!isRetryableGeminiError(primaryErr)) {
      throw primaryErr;
    }

    console.warn(
      `[Gemini] ${taskLabel} falling back from ${PRIMARY_MODEL} to ${FALLBACK_MODEL} after ${Date.now() - startedAt}ms`
    );

    return await withExponentialBackoff(
      async (attempt) => {
        const res = await callWithOptionalTimeout(buildRequest(FALLBACK_MODEL, defaultThinking));
        console.info(`[Gemini] ${taskLabel} succeeded on fallback ${FALLBACK_MODEL} attempt=${attempt} in ${Date.now() - startedAt}ms`);
        return res;
      },
      {
        maxAttempts: 2,
        baseDelayMs: 800,
        shouldRetry: isRetryableGeminiError,
      }
    );
  }
}

export async function transcribeAudioToSegments(params: {
  audioBuffer: Buffer;
  mimeType: string;
  durationSec: number;
  offsetSec?: number;
  videoTitle: string;
}): Promise<TranscriptSegment[]> {
  if (!params.audioBuffer || params.audioBuffer.length < 128) {
    return [];
  }

  const safeDuration = Math.max(1, params.durationSec);
  const offsetSec = Math.max(0, params.offsetSec ?? 0);

  try {
    const response = await generateWithResilience(
      `transcribe(offset=${offsetSec.toFixed(0)}s)`,
      (model, thinkingLevel) => ({
        model,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: params.mimeType,
                data: params.audioBuffer.toString('base64'),
              },
            },
            {
              text: [
                `Video Title: ${params.videoTitle}`,
                `Audio Chunk Duration: ${safeDuration.toFixed(1)} seconds (starting at ${offsetSec.toFixed(1)}s in full video)`,
                'Listen carefully to the audio track and transcribe all spoken dialogue accurately into sequential timestamped segments relative to this audio chunk (0 to chunk duration).',
                'Use natural punctuation, detect speaker turns where evident, and return an empty array [] if there is no clear spoken dialogue (e.g. instrumental music or ambient sound only).',
              ].join('\n'),
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                start: { type: Type.NUMBER, description: 'Start time in seconds (>= 0)' },
                end: { type: Type.NUMBER, description: 'End time in seconds (<= duration)' },
                speaker: { type: Type.STRING, description: 'Speaker label, e.g. Host or Speaker 1' },
                text: { type: Type.STRING, description: 'Punctuated spoken text for this segment' },
              },
              required: ['start', 'end', 'text'],
            },
          },
        },
      })
    );

    const parsed = parseGeminiJson<
      Array<{
        start: number;
        end: number;
        speaker?: string;
        text: string;
      }>
    >(response.text, []);

    return parsed
      .filter((s) => s.text && s.text.trim().length > 0)
      .map((s, idx) => {
        const localStart = Math.max(0, Math.min(safeDuration - 0.5, Number(s.start) || 0));
        const localEnd = Math.max(localStart + 0.5, Math.min(safeDuration, Number(s.end) || localStart + 3));
        return {
          id: `seg-${Math.round(offsetSec)}-${idx + 1}`,
          start: Number((offsetSec + localStart).toFixed(2)),
          end: Number((offsetSec + localEnd).toFixed(2)),
          speaker: s.speaker || 'Speaker 1',
          text: s.text.trim(),
        };
      });
  } catch (error) {
    throw formatGeminiError(error);
  }
}

export interface DetectedClipMoment {
  title: string;
  hook: string;
  description: string;
  hashtags: string;
  startSec: number;
  endSec: number;
  scoreBreakdown: ScoreBreakdown;
  viralScore: number;
  captions: CaptionLine[];
}

export async function analyzeVideoFramesToMoments(params: {
  title: string;
  durationSec: number;
  frames: Array<{ timestampSec: number; jpegBuffer: Buffer }>;
  config: ProjectConfig;
}): Promise<{ transcript: TranscriptSegment[]; moments: DetectedClipMoment[] }> {
  const safeDuration = Math.max(2, params.durationSec);
  const desiredCount = Math.max(1, Math.min(10, params.config.clipCount));
  const targetLen = Math.min(safeDuration, Math.max(4, params.config.clipDuration));

  const parts: Array<
    | { inlineData: { mimeType: string; data: string } }
    | { text: string }
  > = [];

  for (const frame of params.frames) {
    parts.push({ text: `Keyframe at ${frame.timestampSec.toFixed(1)}s:` });
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: frame.jpegBuffer.toString('base64'),
      },
    });
  }

  parts.push({
    text: [
      `Video Title: "${params.title}" (total duration: ${safeDuration.toFixed(1)}s).`,
      'No clear spoken dialogue was present in this video (visual/music/B-roll/screen capture).',
      `Target content style: ${params.config.contentStyle}.`,
      `Using the timestamped keyframes above, summarize the visual scenes sequentially and select ${desiredCount} distinct engaging clip windows (up to ~${targetLen.toFixed(0)}s each, strictly between 0 and ${safeDuration.toFixed(1)}s).`,
      'Provide a concise visual narrative caption line for each selected clip, catchy title, authentic hook, social description, hashtags, and heuristic engagement breakdown (0-99).',
    ].join('\n'),
  });

  try {
    const response = await generateWithResilience(
      'analyzeVideoFramesToMoments',
      (model, thinkingLevel) => ({
        model,
        contents: { parts },
        config: {
          thinkingConfig: { thinkingLevel },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    start: { type: Type.NUMBER },
                    end: { type: Type.NUMBER },
                    text: { type: Type.STRING },
                  },
                  required: ['start', 'end', 'text'],
                },
              },
              clips: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    hook: { type: Type.STRING },
                    description: { type: Type.STRING },
                    hashtags: { type: Type.STRING },
                    captionText: { type: Type.STRING },
                    startSec: { type: Type.NUMBER },
                    endSec: { type: Type.NUMBER },
                    hookStrength: { type: Type.INTEGER },
                    audienceRelevance: { type: Type.INTEGER },
                    emotionalImpact: { type: Type.INTEGER },
                    infoValue: { type: Type.INTEGER },
                    storyCompleteness: { type: Type.INTEGER },
                  },
                  required: [
                    'title',
                    'hook',
                    'description',
                    'hashtags',
                    'startSec',
                    'endSec',
                    'hookStrength',
                    'audienceRelevance',
                    'emotionalImpact',
                    'infoValue',
                    'storyCompleteness',
                  ],
                },
              },
            },
            required: ['scenes', 'clips'],
          },
        },
      })
    );

    const parsed = parseGeminiJson<{
      scenes?: Array<{ start: number; end: number; text: string }>;
      clips?: Array<{
        title: string;
        hook: string;
        description: string;
        hashtags: string;
        captionText?: string;
        startSec: number;
        endSec: number;
        hookStrength: number;
        audienceRelevance: number;
        emotionalImpact: number;
        infoValue: number;
        storyCompleteness: number;
      }>;
    }>(response.text, {});

    const transcript: TranscriptSegment[] = (parsed.scenes ?? [])
      .filter((s) => s.text && s.text.trim().length > 0)
      .map((s, idx) => {
        const win = clampClipWindow(s.start, s.end, safeDuration, 0.5);
        return {
          id: `scene-${idx + 1}`,
          start: win.startSec,
          end: win.endSec,
          speaker: 'Visual Scene',
          text: s.text.trim(),
        };
      });

    const rawClips = parsed.clips ?? [];
    const moments: DetectedClipMoment[] = [];

    for (let idx = 0; idx < desiredCount; idx++) {
      const item = rawClips[idx];
      const fallbackStart =
        desiredCount === 1
          ? 0
          : Math.max(0, (idx / desiredCount) * Math.max(0, safeDuration - Math.min(targetLen, safeDuration)));
      const fallbackEnd = Math.min(safeDuration, fallbackStart + targetLen);

      const window = item
        ? clampClipWindow(item.startSec, item.endSec, safeDuration, Math.min(3, safeDuration))
        : clampClipWindow(fallbackStart, fallbackEnd, safeDuration, Math.min(3, safeDuration));

      const scoreBreakdown: ScoreBreakdown = {
        hookStrength: clamp99(item?.hookStrength ?? 82 - idx * 2),
        audienceRelevance: clamp99(item?.audienceRelevance ?? 80),
        emotionalImpact: clamp99(item?.emotionalImpact ?? 78),
        infoValue: clamp99(item?.infoValue ?? 79),
        storyCompleteness: clamp99(item?.storyCompleteness ?? 81),
      };

      const rawCaptions = splitTranscriptIntoCaptions(transcript, window.startSec, window.endSec, 6);
      const fallbackCaptionText = item?.captionText?.trim() || item?.hook?.trim() || '';
      const captions: CaptionLine[] =
        rawCaptions.length > 0
          ? rawCaptions
          : fallbackCaptionText
            ? [
                {
                  id: `vis-cap-${idx + 1}`,
                  start: 0,
                  end: Math.min(window.durationSec, 3.8),
                  text: fallbackCaptionText,
                  highlightWords: [],
                },
              ]
            : [];

      moments.push({
        title: item?.title?.trim() || `${params.title.slice(0, 40)} — Highlight ${idx + 1}`,
        hook: item?.hook?.trim() || 'Standout visual sequence',
        description: item?.description?.trim() || `Selected highlight clip from ${params.title}.`,
        hashtags: item?.hashtags?.trim() || '#shorts #video #highlights',
        startSec: window.startSec,
        endSec: window.endSec,
        scoreBreakdown,
        viralScore: computeEstimatedViralScore(scoreBreakdown),
        captions,
      });
    }

    return {
      transcript,
      moments: moments.sort((a, b) => b.viralScore - a.viralScore),
    };
  } catch (error) {
    throw formatGeminiError(error);
  }
}

export async function detectEngagingMoments(params: {
  title: string;
  durationSec: number;
  transcript: TranscriptSegment[];
  config: ProjectConfig;
}): Promise<DetectedClipMoment[]> {
  const safeDuration = Math.max(2, params.durationSec);
  const desiredCount = Math.max(1, Math.min(10, params.config.clipCount));
  const targetLen = Math.min(safeDuration, Math.max(4, params.config.clipDuration));

  const maxSegments = 450;
  const sourceSegments =
    params.transcript.length > maxSegments
      ? params.transcript.filter((_, i) => i % Math.ceil(params.transcript.length / maxSegments) === 0)
      : params.transcript;

  const transcriptText = sourceSegments
    .map((s) => `[${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s] ${s.speaker || 'Speaker'}: ${s.text}`)
    .join('\n');

  try {
    const response = await generateWithResilience(
      'detectEngagingMoments',
      (model, thinkingLevel) => ({
        model,
        contents: [
          `Analyze the transcript of "${params.title}" (total duration: ${safeDuration.toFixed(1)}s).`,
          `Target content style: ${params.config.contentStyle}.`,
          `Select ${desiredCount} distinct, self-contained moments ideal for short-form social clips (target duration around ${targetLen.toFixed(1)}s each, strictly bounded between 0 and ${safeDuration.toFixed(1)}s).`,
          'Choose natural story boundaries, strong opening hooks, emotional insights, or actionable takeaways rather than arbitrary intervals.',
          'Do NOT misrepresent the speaker. Provide a heuristic engagement score breakdown (0-99) across hookStrength, audienceRelevance, emotionalImpact, infoValue, and storyCompleteness.',
          '',
          'Transcript:',
          transcriptText,
        ].join('\n'),
        config: {
          systemInstruction:
            'You are an expert short-form video editor and content strategist. Always return valid JSON matching the schema with accurate timestamps inside the source video duration.',
          thinkingConfig: { thinkingLevel: model === PRIMARY_MODEL ? ThinkingLevel.MEDIUM : thinkingLevel },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: 'Catchy short clip title under 65 chars' },
                hook: { type: Type.STRING, description: 'Opening hook line grounded in the clip content' },
                description: { type: Type.STRING, description: 'Social post caption summary (1-2 sentences)' },
                hashtags: { type: Type.STRING, description: 'Space-separated relevant hashtags, e.g. #engineering #founders' },
                startSec: { type: Type.NUMBER, description: 'Clip start timestamp in seconds' },
                endSec: { type: Type.NUMBER, description: 'Clip end timestamp in seconds' },
                hookStrength: { type: Type.INTEGER },
                audienceRelevance: { type: Type.INTEGER },
                emotionalImpact: { type: Type.INTEGER },
                infoValue: { type: Type.INTEGER },
                storyCompleteness: { type: Type.INTEGER },
              },
              required: [
                'title',
                'hook',
                'description',
                'hashtags',
                'startSec',
                'endSec',
                'hookStrength',
                'audienceRelevance',
                'emotionalImpact',
                'infoValue',
                'storyCompleteness',
              ],
            },
          },
        },
      })
    );

    const rawList = parseGeminiJson<
      Array<{
        title: string;
        hook: string;
        description: string;
        hashtags: string;
        startSec: number;
        endSec: number;
        hookStrength: number;
        audienceRelevance: number;
        emotionalImpact: number;
        infoValue: number;
        storyCompleteness: number;
      }>
    >(response.text, []);

    const moments: DetectedClipMoment[] = [];
    const effectiveCount = Math.min(desiredCount, Math.max(rawList.length, desiredCount));

    for (let idx = 0; idx < effectiveCount; idx++) {
      const item = rawList[idx];
      const fallbackStart =
        effectiveCount === 1
          ? 0
          : Math.max(0, (idx / effectiveCount) * Math.max(0, safeDuration - Math.min(targetLen, safeDuration)));
      const fallbackEnd = Math.min(safeDuration, fallbackStart + targetLen);

      const minClipLen = Math.min(safeDuration, 3);
      let window = item
        ? clampClipWindow(item.startSec, item.endSec, safeDuration, minClipLen)
        : clampClipWindow(fallbackStart, fallbackEnd, safeDuration, minClipLen);

      if (window.durationSec < minClipLen && safeDuration >= minClipLen) {
        window = clampClipWindow(fallbackStart, fallbackEnd, safeDuration, minClipLen);
      }

      const scoreBreakdown: ScoreBreakdown = {
        hookStrength: clamp99(item?.hookStrength ?? 82 - idx),
        audienceRelevance: clamp99(item?.audienceRelevance ?? 80),
        emotionalImpact: clamp99(item?.emotionalImpact ?? 78),
        infoValue: clamp99(item?.infoValue ?? 81),
        storyCompleteness: clamp99(item?.storyCompleteness ?? 79),
      };

      const captions = splitTranscriptIntoCaptions(
        params.transcript,
        window.startSec,
        window.endSec,
        6
      );

      moments.push({
        title: item?.title?.trim() || `Highlight Clip ${idx + 1}`,
        hook: item?.hook?.trim() || 'Key insight from this moment',
        description: item?.description?.trim() || item?.hook?.trim() || 'Standout video moment.',
        hashtags: item?.hashtags?.trim() || '#shorts #video #insights',
        startSec: window.startSec,
        endSec: window.endSec,
        scoreBreakdown,
        viralScore: computeEstimatedViralScore(scoreBreakdown),
        captions,
      });
    }

    if (moments.length === 0) {
      throw new Error('AI could not identify clip boundaries from the transcript.');
    }

    return moments.sort((a, b) => b.viralScore - a.viralScore);
  } catch (error) {
    throw formatGeminiError(error);
  }
}

export async function regenerateClipCopy(params: {
  projectTitle: string;
  transcriptSnippet: string;
  currentTitle: string;
  contentStyle: string;
}): Promise<{ title: string; hook: string; description: string; hashtags: string }> {
  try {
    const response = await generateWithResilience(
      'regenerateClipCopy',
      (model, thinkingLevel) => ({
        model,
        contents: [
          `Video: ${params.projectTitle}`,
          `Style: ${params.contentStyle}`,
          `Previous Title: ${params.currentTitle}`,
          `Clip Transcript:\n${params.transcriptSnippet}`,
          'Generate a fresh, sharper alternative title, opening hook, social description, and hashtags grounded strictly in the clip transcript.',
        ].join('\n'),
        config: {
          thinkingConfig: { thinkingLevel },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              hook: { type: Type.STRING },
              description: { type: Type.STRING },
              hashtags: { type: Type.STRING },
            },
            required: ['title', 'hook', 'description', 'hashtags'],
          },
        },
      })
    );
    const parsed = parseGeminiJson<{
      title?: string;
      hook?: string;
      description?: string;
      hashtags?: string;
    }>(response.text, {});
    return {
      title: parsed.title?.trim() || params.currentTitle,
      hook: parsed.hook?.trim() || 'A fresh perspective worth watching',
      description: parsed.description?.trim() || 'Watch this standout moment.',
      hashtags: parsed.hashtags?.trim() || '#clip #creator #highlights',
    };
  } catch (error) {
    throw formatGeminiError(error);
  }
}

export async function analyzeYouTubeVideoWithGemini(params: {
  youtubeUrl: string;
  title: string;
  channelName: string;
  config: ProjectConfig;
}): Promise<{
  durationSec: number;
  transcript: TranscriptSegment[];
  moments: DetectedClipMoment[];
}> {
  const desiredCount = Math.max(1, Math.min(10, params.config.clipCount));
  const targetLen = Math.max(5, params.config.clipDuration);

  try {
    const response = await generateWithResilience(
      'analyzeYouTubeVideoWithGemini',
      (model, thinkingLevel) => ({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                fileData: {
                  fileUri: params.youtubeUrl,
                },
              },
              {
                text: [
                  `Watch and listen closely to this YouTube video: "${params.title}" by "${params.channelName}".`,
                  `Target content style: ${params.config.contentStyle}.`,
                  '1. Determine the accurate total video duration in seconds (`durationSec`).',
                  '2. Generate a clean, accurate, sequential timestamped transcript (`transcript`) covering the spoken dialogue or key narration in the video with speaker labels.',
                  `3. Select ${desiredCount} distinct, self-contained, engaging short-form clip windows (around ${targetLen}s each, or proportional if the source video is shorter) with startSec and endSec strictly within [0, durationSec].`,
                  '4. For each clip, write a catchy title (< 65 chars), an authentic opening hook grounded in the video, a social description, hashtags, and a 5-factor engagement score breakdown (0-99).',
                  'Never fabricate quotes or events not present in the video.',
                ].join('\n'),
              },
            ],
          },
        ],
        config: {
          systemInstruction:
            'You are an expert short-form video editor. Analyze the attached YouTube video accurately and return valid JSON matching the schema.',
          thinkingConfig: { thinkingLevel: model === PRIMARY_MODEL ? ThinkingLevel.MEDIUM : thinkingLevel },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              durationSec: { type: Type.NUMBER, description: 'Total duration of the video in seconds' },
              transcript: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    start: { type: Type.NUMBER },
                    end: { type: Type.NUMBER },
                    speaker: { type: Type.STRING },
                    text: { type: Type.STRING },
                  },
                  required: ['start', 'end', 'text'],
                },
              },
              clips: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    hook: { type: Type.STRING },
                    description: { type: Type.STRING },
                    hashtags: { type: Type.STRING },
                    startSec: { type: Type.NUMBER },
                    endSec: { type: Type.NUMBER },
                    hookStrength: { type: Type.INTEGER },
                    audienceRelevance: { type: Type.INTEGER },
                    emotionalImpact: { type: Type.INTEGER },
                    infoValue: { type: Type.INTEGER },
                    storyCompleteness: { type: Type.INTEGER },
                  },
                  required: [
                    'title',
                    'hook',
                    'description',
                    'hashtags',
                    'startSec',
                    'endSec',
                    'hookStrength',
                    'audienceRelevance',
                    'emotionalImpact',
                    'infoValue',
                    'storyCompleteness',
                  ],
                },
              },
            },
            required: ['durationSec', 'transcript', 'clips'],
          },
        },
      })
    );

    const parsed = parseGeminiJson<{
      durationSec?: number;
      transcript?: Array<{ start: number; end: number; speaker?: string; text: string }>;
      clips?: Array<{
        title: string;
        hook: string;
        description: string;
        hashtags: string;
        startSec: number;
        endSec: number;
        hookStrength: number;
        audienceRelevance: number;
        emotionalImpact: number;
        infoValue: number;
        storyCompleteness: number;
      }>;
    }>(response.text, {});

    const rawTranscript = (parsed.transcript ?? []).filter((s) => s.text && s.text.trim().length > 0);
    const maxTranscriptEnd = rawTranscript.reduce((m, s) => Math.max(m, Number(s.end) || 0), 0);
    const maxClipEnd = (parsed.clips ?? []).reduce((m, c) => Math.max(m, Number(c.endSec) || 0), 0);
    const durationSec = Math.max(
      4,
      Number(parsed.durationSec) || maxClipEnd || maxTranscriptEnd || 30
    );

    const transcript: TranscriptSegment[] = rawTranscript
      .map((s, idx) => {
        const start = Math.max(0, Math.min(durationSec - 0.5, Number(s.start) || 0));
        const end = Math.max(start + 0.5, Math.min(durationSec, Number(s.end) || start + 3));
        return {
          id: `yt-seg-${idx + 1}`,
          start: Number(start.toFixed(2)),
          end: Number(end.toFixed(2)),
          speaker: s.speaker?.trim() || 'Speaker',
          text: s.text.trim(),
        };
      })
      .sort((a, b) => a.start - b.start);

    const rawClips = parsed.clips ?? [];
    const effectiveCount = Math.min(desiredCount, Math.max(rawClips.length, desiredCount));
    const moments: DetectedClipMoment[] = [];
    const minClipLen = Math.min(durationSec, 3);

    for (let idx = 0; idx < effectiveCount; idx++) {
      const item = rawClips[idx];
      const fallbackStart =
        effectiveCount === 1
          ? 0
          : Math.max(0, (idx / effectiveCount) * Math.max(0, durationSec - Math.min(targetLen, durationSec)));
      const fallbackEnd = Math.min(durationSec, fallbackStart + Math.min(targetLen, durationSec));

      const window = item
        ? clampClipWindow(item.startSec, item.endSec, durationSec, minClipLen)
        : clampClipWindow(fallbackStart, fallbackEnd, durationSec, minClipLen);

      const scoreBreakdown: ScoreBreakdown = {
        hookStrength: clamp99(item?.hookStrength ?? 83 - idx),
        audienceRelevance: clamp99(item?.audienceRelevance ?? 81),
        emotionalImpact: clamp99(item?.emotionalImpact ?? 79),
        infoValue: clamp99(item?.infoValue ?? 82),
        storyCompleteness: clamp99(item?.storyCompleteness ?? 80),
      };

      const captions = splitTranscriptIntoCaptions(transcript, window.startSec, window.endSec, 6);
      if (captions.length === 0 && (item?.hook || item?.description)) {
        captions.push({
          id: `yt-cap-${idx + 1}`,
          start: 0,
          end: Math.min(window.durationSec, 3.8),
          text: (item.hook || item.description).trim(),
          highlightWords: [],
        });
      }

      moments.push({
        title: item?.title?.trim() || `${params.title.slice(0, 42)} — Clip ${idx + 1}`,
        hook: item?.hook?.trim() || 'Standout moment from this video',
        description: item?.description?.trim() || `Key highlight from ${params.title}.`,
        hashtags: item?.hashtags?.trim() || '#shorts #youtube #clips',
        startSec: window.startSec,
        endSec: window.endSec,
        scoreBreakdown,
        viralScore: computeEstimatedViralScore(scoreBreakdown),
        captions,
      });
    }

    return {
      durationSec: Number(durationSec.toFixed(2)),
      transcript,
      moments: moments.sort((a, b) => b.viralScore - a.viralScore),
    };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    if (
      raw.includes('INVALID_ARGUMENT') ||
      raw.includes('400') ||
      raw.includes('NOT_FOUND') ||
      raw.includes('404')
    ) {
      throw new Error(
        'This YouTube video could not be accessed directly by Gemini AI (it may be private, age-restricted, or disabled for external playback). Please try a public YouTube link or upload your MP4 file directly.'
      );
    }
    throw formatGeminiError(error);
  }
}

export async function synthesizeSampleSpeechWav(sampleId: string): Promise<Buffer | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  const ai = getGeminiClient();

  const runWithTimeout = async <T>(promise: Promise<T>, timeoutMs = 6000): Promise<T | null> => {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  try {
    if (sampleId === 'founders-scaling') {
      const response = await runWithTimeout(
        ai.models.generateContent({
          model: 'gemini-3.8-flash-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: 'Alex: Everyone assumes hiring fifty engineers doubles your product velocity. In reality, coordination overhead cuts output in half unless you protect small autonomous squads.',
                  speechMetadata: {
                    speaker: 'Alex',
                    style: 'Focused, articulate podcast host',
                  },
                },
                {
                  text: 'Sam: That is the biggest lesson we learned scaling to four million users. A team of four engineers who talk to customers every week will consistently outship a massive department stuck in status meetings. Keep the feedback loop under twenty four hours, ship real increments daily, and measure retention instead of story points.',
                  speechMetadata: {
                    speaker: 'Sam',
                    style: 'Thoughtful startup founder',
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: [
                  { speaker: 'Alex', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
                  { speaker: 'Sam', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } },
                ],
              },
            },
          },
        }),
        6000
      );
      const base64 = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      return base64 ? Buffer.from(base64, 'base64') : null;
    }

    const response = await runWithTimeout(
      ai.models.generateContent({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: 'Most long-form recordings fail on vertical feeds for one simple reason: they bury the core insight four minutes into the talk. When you lead with the sharpest question in the first three seconds, frame the speaker cleanly, and pair every key phrase with crisp timed captions, completion rates jump dramatically. Great short-form editing never alters the truth of the argument. It simply removes friction between the speaker and the audience.',
                speechMetadata: {
                  style: 'Confident, clear keynote speaker on stage',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      }),
      6000
    );
    const base64 = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64 ? Buffer.from(base64, 'base64') : null;
  } catch (err) {
    console.warn('Sample TTS synthesis fallback triggered:', err instanceof Error ? err.message : err);
    return null;
  }
}

function clamp99(n: number): number {
  return Math.max(40, Math.min(99, Math.round(Number(n) || 80)));
}

export interface AiClipEditResult {
  videoTheme: import('../shared/types.ts').VideoTheme;
  captionStyle: import('../shared/types.ts').CaptionStyle;
  fontFamily: string;
  highlightColor: string;
  captions: CaptionLine[];
  title: string;
  hook: string;
  description: string;
  hashtags: string;
  aiSummary: string;
}

export async function aiEditClipStylingAndCaptions(params: {
  prompt: string;
  projectTitle: string;
  clipTitle: string;
  hook: string;
  description: string;
  hashtags: string;
  durationSec: number;
  captionStyle: import('../shared/types.ts').CaptionStyle;
  videoTheme: import('../shared/types.ts').VideoTheme;
  fontFamily: string;
  highlightColor: string;
  captions: CaptionLine[];
}): Promise<AiClipEditResult> {
  const { normalizeCaptionStyle, normalizeVideoTheme } = await import('../utils/videoStyles.ts');

  const safeCaptions = (params.captions || []).map((c, idx) => ({
    id: c.id || `cap-${idx + 1}`,
    start: Number(c.start) || 0,
    end: Number(c.end) || Math.max(0.5, (Number(c.start) || 0) + 2),
    text: String(c.text || '').trim(),
    highlightWords: Array.isArray(c.highlightWords) ? c.highlightWords : [],
  }));

  try {
    const response = await generateWithResilience(
      'aiEditClipStylingAndCaptions',
      (model, thinkingLevel) => ({
        model,
        contents: [
          `User Editing Request: "${params.prompt}"`,
          '',
          `Project Title: ${params.projectTitle}`,
          `Clip Title: ${params.clipTitle}`,
          `Current Hook: ${params.hook}`,
          `Current Description: ${params.description}`,
          `Current Hashtags: ${params.hashtags}`,
          `Clip Duration: ${params.durationSec.toFixed(1)}s`,
          `Current Video Theme: ${params.videoTheme}`,
          `Current Caption Style: ${params.captionStyle}`,
          `Current Font: ${params.fontFamily}`,
          `Current Highlight Color: ${params.highlightColor}`,
          '',
          'Current Timed Captions:',
          JSON.stringify(safeCaptions, null, 2),
          '',
          'Instructions:',
          '1. Select the best matching `videoTheme` strictly from: Original, Cinematic, Neon Cyber, Warm Sunset, Noir Monochrome, Vibrant Pop, Studio Clean.',
          '2. Select the best matching `captionStyle` strictly from: Minimal, Neon Glow, Professional, Comic Pop, Gradient Box, Typewriter, Glitch Kinetic, Modern, Animated, Bold, Karaoke. (Prefer Neon Glow, Professional, Comic Pop, Gradient Box, Typewriter, or Glitch Kinetic when the user asks for fancy, broadcast, or styled captions.)',
          '3. Choose `fontFamily` from: Plus Jakarta Sans, DM Sans, JetBrains Mono, Arial.',
          '4. Choose a crisp `highlightColor` hex string (#38BDF8, #22D3EE, #A78BFA, #FBBF24, #34D399, #FB7185, or #F472B6).',
          '5. Upgrade `captions` for visual punch while keeping timestamps within [0, clipDuration] and preserving the true spoken meaning: pick 1-2 high-impact `highlightWords` per line, tighten phrasing for readability, and optionally add tasteful expressive accents/emojis if requested.',
          '6. Keep `title`, `hook`, `description`, `hashtags` unchanged unless the prompt asks to rewrite copy or adapt tone.',
          '7. Return a concise 1-sentence `aiSummary` explaining what was applied.',
        ].join('\n'),
        config: {
          systemInstruction:
            'You are ClipGenius AI Studio Editor. Apply the user prompt accurately to video theme, fancy caption styling, and subtitle cues. Return valid JSON matching the schema.',
          thinkingConfig: { thinkingLevel },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              videoTheme: { type: Type.STRING },
              captionStyle: { type: Type.STRING },
              fontFamily: { type: Type.STRING },
              highlightColor: { type: Type.STRING },
              title: { type: Type.STRING },
              hook: { type: Type.STRING },
              description: { type: Type.STRING },
              hashtags: { type: Type.STRING },
              aiSummary: { type: Type.STRING },
              captions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    start: { type: Type.NUMBER },
                    end: { type: Type.NUMBER },
                    text: { type: Type.STRING },
                    highlightWords: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                  required: ['start', 'end', 'text', 'highlightWords'],
                },
              },
            },
            required: [
              'videoTheme',
              'captionStyle',
              'fontFamily',
              'highlightColor',
              'title',
              'hook',
              'description',
              'hashtags',
              'aiSummary',
              'captions',
            ],
          },
        },
      }),
      {
        defaultThinkingLevel: ThinkingLevel.MINIMAL,
        perAttemptTimeoutMs: 12000,
        maxPrimaryAttempts: 1,
      }
    );

    const parsed = parseGeminiJson<{
      videoTheme?: string;
      captionStyle?: string;
      fontFamily?: string;
      highlightColor?: string;
      title?: string;
      hook?: string;
      description?: string;
      hashtags?: string;
      aiSummary?: string;
      captions?: Array<{
        start: number;
        end: number;
        text: string;
        highlightWords?: string[];
      }>;
    }>(response.text, {});

    const allowedFonts = ['Plus Jakarta Sans', 'DM Sans', 'JetBrains Mono', 'Arial'];
    const fontFamily = allowedFonts.includes(parsed.fontFamily || '')
      ? (parsed.fontFamily as string)
      : params.fontFamily;
    const hexColor = /^#[0-9a-fA-F]{6}$/.test(parsed.highlightColor || '')
      ? (parsed.highlightColor as string).toUpperCase()
      : params.highlightColor;

    const maxDur = Math.max(1.5, params.durationSec);
    const updatedCaptions: CaptionLine[] =
      Array.isArray(parsed.captions) && parsed.captions.length > 0
        ? parsed.captions
            .filter((c) => c.text && c.text.trim().length > 0)
            .map((c, idx) => {
              const start = Math.max(0, Math.min(maxDur - 0.3, Number(c.start) || 0));
              const end = Math.max(start + 0.3, Math.min(maxDur, Number(c.end) || start + 2));
              return {
                id: safeCaptions[idx]?.id || `ai-cap-${Date.now()}-${idx}`,
                start: Number(start.toFixed(2)),
                end: Number(end.toFixed(2)),
                text: c.text.trim(),
                highlightWords: Array.isArray(c.highlightWords)
                  ? c.highlightWords.map((w) => String(w).trim()).filter(Boolean).slice(0, 3)
                  : [],
              };
            })
        : safeCaptions;

    const videoTheme = normalizeVideoTheme(parsed.videoTheme);
    const captionStyle = normalizeCaptionStyle(parsed.captionStyle);

    return {
      videoTheme,
      captionStyle,
      fontFamily,
      highlightColor: hexColor,
      captions: updatedCaptions,
      title: parsed.title?.trim() || params.clipTitle,
      hook: parsed.hook?.trim() || params.hook,
      description: parsed.description?.trim() || params.description,
      hashtags: parsed.hashtags?.trim() || params.hashtags,
      aiSummary:
        parsed.aiSummary?.trim() ||
        `Applied ${videoTheme} theme with ${captionStyle} captions.`,
    };
  } catch (error) {
    throw formatGeminiError(error);
  }
}
