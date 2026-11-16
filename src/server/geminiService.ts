import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  CaptionLine,
  ProjectConfig,
  ScoreBreakdown,
  TranscriptSegment,
} from '../shared/types.ts';
import {
  computeEstimatedViralScore,
  splitTranscriptIntoCaptions,
} from '../utils/youtube.ts';

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
      'Gemini API rate limit reached. Please wait a moment and retry your request.'
    );
  }
  return new Error(`AI analysis error: ${raw}`);
}

export async function transcribeAudioToSegments(params: {
  audioBuffer: Buffer;
  mimeType: string;
  durationSec: number;
  videoTitle: string;
}): Promise<TranscriptSegment[]> {
  const ai = getGeminiClient();
  const safeDuration = Math.max(1, params.durationSec);

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
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
              `Exact Video Duration: ${safeDuration.toFixed(1)} seconds`,
              'Listen carefully to the audio track and transcribe all spoken dialogue accurately into sequential timestamped segments covering 0 to the video duration.',
              'Use natural punctuation, detect speaker turns where evident, and return an empty array [] if there is no spoken dialogue.',
            ].join('\n'),
          },
        ],
      },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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
    });

    const parsed = JSON.parse(response.text ?? '[]') as Array<{
      start: number;
      end: number;
      speaker?: string;
      text: string;
    }>;

    const cleaned = parsed
      .filter((s) => s.text && s.text.trim().length > 0)
      .map((s, idx) => {
        const start = Math.max(0, Math.min(safeDuration - 0.5, Number(s.start) || 0));
        const end = Math.max(start + 0.5, Math.min(safeDuration, Number(s.end) || start + 3));
        return {
          id: `seg-${idx + 1}`,
          start: Number(start.toFixed(2)),
          end: Number(end.toFixed(2)),
          speaker: s.speaker || 'Speaker 1',
          text: s.text.trim(),
        };
      });

    if (cleaned.length === 0) {
      throw new Error('No spoken dialogue was detected in the video audio track.');
    }

    return cleaned;
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

export async function detectEngagingMoments(params: {
  title: string;
  durationSec: number;
  transcript: TranscriptSegment[];
  config: ProjectConfig;
}): Promise<DetectedClipMoment[]> {
  const ai = getGeminiClient();
  const safeDuration = Math.max(5, params.durationSec);
  const desiredCount = Math.max(1, Math.min(10, params.config.clipCount));
  const targetLen = Math.min(safeDuration, Math.max(8, params.config.clipDuration));

  const transcriptText = params.transcript
    .map((s) => `[${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s] ${s.speaker || 'Speaker'}: ${s.text}`)
    .join('\n');

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        `Analyze the transcript of "${params.title}" (total duration: ${safeDuration.toFixed(1)}s).`,
        `Target content style: ${params.config.contentStyle}.`,
        `Select ${desiredCount} distinct, self-contained moments ideal for short-form social clips (target duration around ${targetLen}s each, strictly bounded between 0 and ${safeDuration.toFixed(1)}s).`,
        'Choose natural story boundaries, strong opening hooks, emotional insights, or actionable takeaways rather than arbitrary intervals.',
        'Do NOT misrepresent the speaker. Provide a heuristic engagement score breakdown (0-99) across hookStrength, audienceRelevance, emotionalImpact, infoValue, and storyCompleteness.',
        '',
        'Transcript:',
        transcriptText,
      ].join('\n'),
      config: {
        systemInstruction:
          'You are an expert short-form video editor and content strategist. Always return valid JSON matching the schema with accurate timestamps inside the source video duration.',
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
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
    });

    const rawList = JSON.parse(response.text ?? '[]') as Array<{
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

    const moments: DetectedClipMoment[] = rawList
      .slice(0, desiredCount)
      .map((item, idx) => {
        let startSec = Math.max(0, Number(item.startSec) || 0);
        let endSec = Math.min(safeDuration, Number(item.endSec) || startSec + targetLen);
        if (endSec - startSec < 5) {
          startSec = Math.max(0, Math.min(safeDuration - 8, (idx * safeDuration) / desiredCount));
          endSec = Math.min(safeDuration, startSec + Math.min(targetLen, safeDuration - startSec));
        }

        const scoreBreakdown: ScoreBreakdown = {
          hookStrength: clamp99(item.hookStrength),
          audienceRelevance: clamp99(item.audienceRelevance),
          emotionalImpact: clamp99(item.emotionalImpact),
          infoValue: clamp99(item.infoValue),
          storyCompleteness: clamp99(item.storyCompleteness),
        };

        const captions = splitTranscriptIntoCaptions(params.transcript, startSec, endSec, 6);
        return {
          title: item.title.trim() || `Highlight Clip ${idx + 1}`,
          hook: item.hook.trim() || 'Key insight from this moment',
          description: item.description.trim() || item.hook.trim(),
          hashtags: item.hashtags.trim() || '#shorts #video #insights',
          startSec: Number(startSec.toFixed(2)),
          endSec: Number(endSec.toFixed(2)),
          scoreBreakdown,
          viralScore: computeEstimatedViralScore(scoreBreakdown),
          captions,
        };
      });

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
  const ai = getGeminiClient();
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: [
        `Video: ${params.projectTitle}`,
        `Style: ${params.contentStyle}`,
        `Previous Title: ${params.currentTitle}`,
        `Clip Transcript:\n${params.transcriptSnippet}`,
        'Generate a fresh, sharper alternative title, opening hook, social description, and hashtags grounded strictly in the clip transcript.',
      ].join('\n'),
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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
    });
    const parsed = JSON.parse(response.text ?? '{}') as {
      title?: string;
      hook?: string;
      description?: string;
      hashtags?: string;
    };
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

export async function synthesizeSampleSpeechWav(sampleId: string): Promise<Buffer | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  const ai = getGeminiClient();

  try {
    if (sampleId === 'founders-scaling') {
      const response = await ai.models.generateContent({
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
      });
      const base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      return base64 ? Buffer.from(base64, 'base64') : null;
    }

    const response = await ai.models.generateContent({
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
    });
    const base64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64 ? Buffer.from(base64, 'base64') : null;
  } catch (err) {
    console.warn('Sample TTS synthesis fallback triggered:', err);
    return null;
  }
}

function clamp99(n: number): number {
  return Math.max(40, Math.min(99, Math.round(Number(n) || 80)));
}
