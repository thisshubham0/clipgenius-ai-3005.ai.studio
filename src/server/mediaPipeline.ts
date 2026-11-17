import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AspectRatio,
  CaptionLine,
  CaptionStyle,
  ExportResolution,
  StudioSample,
  VideoTheme,
} from '../shared/types.ts';
import {
  buildAssSubtitles,
  buildVideoFilterGraph,
  clampClipWindow,
  getTargetDimensions,
} from '../utils/ffmpegArgs.ts';
import { getVideoThemeMeta, normalizeVideoTheme } from '../utils/videoStyles.ts';
import { runWithConcurrency } from '../utils/pipelineResilience.ts';
import { synthesizeSampleSpeechWav } from './geminiService.ts';

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage');
const SAMPLES_DIR = path.join(STORAGE_ROOT, 'samples');
const UPLOADS_DIR = path.join(STORAGE_ROOT, 'uploads');
const RENDERS_DIR = path.join(STORAGE_ROOT, 'renders');
const TEMP_DIR = path.join(STORAGE_ROOT, 'tmp');

const sampleGenerationLocks = new Map<string, Promise<string>>();

export const STUDIO_SAMPLES: StudioSample[] = [
  {
    id: 'founders-scaling',
    title: 'Founders Talk: Why Small Teams Ship 3x Faster',
    channelName: 'Founders Engineering Desk',
    description:
      'Dual-speaker studio conversation breaking down autonomous squads, customer feedback loops, and engineering velocity.',
    durationSec: 28,
    thumbnailUrl: '/src/assets/images/sample_podcast_thumb_1794825184668.jpg',
    contentStyle: 'Podcast',
    youtubeReferenceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  },
  {
    id: 'keynote-creator-ai',
    title: 'Global Tech Summit: Short-Form Storytelling Craft',
    channelName: 'Summit Keynote Archive',
    description:
      'Stage keynote exploring 3-second opening hooks, framing discipline, and synchronized caption readability.',
    durationSec: 28,
    thumbnailUrl: '/src/assets/images/sample_keynote_thumb_1794825185812.jpg',
    contentStyle: 'Educational',
    youtubeReferenceUrl: 'https://youtu.be/jNQXAC9IVRw',
  },
];

export const SAMPLE_SCRIPTS: Record<
  string,
  Array<{ id: string; start: number; end: number; speaker: string; text: string }>
> = {
  'founders-scaling': [
    {
      id: 'seg-1',
      start: 0,
      end: 7.2,
      speaker: 'Alex',
      text: 'Everyone assumes hiring fifty engineers doubles your product velocity.',
    },
    {
      id: 'seg-2',
      start: 7.2,
      end: 13.8,
      speaker: 'Alex',
      text: 'In reality, coordination overhead cuts output in half unless you protect small autonomous squads.',
    },
    {
      id: 'seg-3',
      start: 13.8,
      end: 21.0,
      speaker: 'Sam',
      text: 'A team of four engineers who talk to customers every week will consistently outship a massive department.',
    },
    {
      id: 'seg-4',
      start: 21.0,
      end: 28.0,
      speaker: 'Sam',
      text: 'Keep the feedback loop under twenty four hours, ship real increments daily, and measure retention instead of story points.',
    },
  ],
  'keynote-creator-ai': [
    {
      id: 'seg-1',
      start: 0,
      end: 7.5,
      speaker: 'Keynote Speaker',
      text: 'Most long-form recordings fail on vertical feeds because they bury the core insight four minutes into the talk.',
    },
    {
      id: 'seg-2',
      start: 7.5,
      end: 15.0,
      speaker: 'Keynote Speaker',
      text: 'Lead with your sharpest question in the first three seconds, frame the speaker cleanly, and pair key phrases with timed captions.',
    },
    {
      id: 'seg-3',
      start: 15.0,
      end: 28.0,
      speaker: 'Keynote Speaker',
      text: 'Great short-form editing never alters the truth of your argument. It simply removes friction between the speaker and the audience.',
    },
  ],
};

export async function ensureStorageDirectories() {
  await Promise.all([
    fs.mkdir(SAMPLES_DIR, { recursive: true }),
    fs.mkdir(UPLOADS_DIR, { recursive: true }),
    fs.mkdir(RENDERS_DIR, { recursive: true }),
    fs.mkdir(TEMP_DIR, { recursive: true }),
  ]);
}

export function getUploadsDir() {
  return UPLOADS_DIR;
}

export function getRendersDir() {
  return RENDERS_DIR;
}

function runProcess(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${cmd} exited with code ${code}: ${stderr.slice(-600)}`));
      }
    });
  });
}

export interface ProbedVideoInfo {
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export async function probeVideoMetadata(filePath: string): Promise<ProbedVideoInfo> {
  const { stdout } = await runProcess('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; duration?: string; width?: number; height?: number }>;
  };

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  if (!videoStream) {
    throw new Error('No readable video stream found in this file.');
  }
  const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');
  const rawDuration = Number(parsed.format?.duration ?? videoStream.duration ?? 0);

  return {
    durationSec: Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 15,
    width: videoStream.width ?? 1280,
    height: videoStream.height ?? 720,
    hasAudio: Boolean(audioStream),
  };
}

export async function resolveProjectSourceFile(
  sourceType: string,
  sourceFilePath: string
): Promise<string> {
  if (sourceFilePath) {
    try {
      await fs.access(sourceFilePath);
      return sourceFilePath;
    } catch {
      // Missing on ephemeral disk (e.g. after container restart)
    }
  }

  const matchedSample = STUDIO_SAMPLES.find((s) => sourceFilePath.includes(`${s.id}.mp4`));
  if (sourceType === 'sample' || matchedSample) {
    const sampleId = matchedSample?.id ?? STUDIO_SAMPLES[0].id;
    console.info(`[Media] Auto-restoring studio sample "${sampleId}" after storage reset`);
    return ensureSampleVideoExists(sampleId);
  }

  throw new Error(
    'Source video file is no longer available on this server instance. Please re-upload your video file.'
  );
}

export interface ExtractedAudioSegment {
  index: number;
  startSec: number;
  durationSec: number;
  buffer: Buffer;
}

export async function extractAllAudioChunksForAi(
  videoPath: string,
  tag: string,
  totalDurationSec: number,
  chunkDurationSec = 720
): Promise<ExtractedAudioSegment[]> {
  await ensureStorageDirectories();
  const safeTotal = Math.max(1, totalDurationSec);
  const safeChunk = Math.max(30, chunkDurationSec);
  const uniquePrefix = `seg-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const pattern = path.join(TEMP_DIR, `${uniquePrefix}-%03d.mp3`);
  const generatedFiles: string[] = [];

  try {
    const t0 = Date.now();
    await runProcess('ffmpeg', [
      '-y',
      '-i',
      videoPath,
      '-vn',
      '-acodec',
      'libmp3lame',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-b:a',
      '24k',
      '-f',
      'segment',
      '-segment_time',
      String(safeChunk),
      '-reset_timestamps',
      '1',
      pattern,
    ]);

    const entries = await fs.readdir(TEMP_DIR);
    const matched = entries
      .filter((name) => name.startsWith(`${uniquePrefix}-`) && name.endsWith('.mp3'))
      .sort();

    const segments: ExtractedAudioSegment[] = [];
    for (let i = 0; i < matched.length; i++) {
      const fullPath = path.join(TEMP_DIR, matched[i]);
      generatedFiles.push(fullPath);
      const buffer = await fs.readFile(fullPath);
      if (buffer.length < 128) continue;
      const startSec = Number((i * safeChunk).toFixed(2));
      const remaining = Math.max(1, safeTotal - startSec);
      const durationSec = Number(Math.min(safeChunk, remaining).toFixed(2));
      segments.push({ index: i, startSec, durationSec, buffer });
    }

    console.info(
      `[FFmpeg] Single-pass audio extraction tag=${tag} chunks=${segments.length} in ${Date.now() - t0}ms`
    );
    return segments;
  } finally {
    await Promise.all(generatedFiles.map((f) => fs.unlink(f).catch(() => {})));
  }
}

export async function extractAudioChunkForAi(
  videoPath: string,
  tag: string,
  startSec = 0,
  durationSec?: number
): Promise<Buffer> {
  await ensureStorageDirectories();
  const outMp3 = path.join(TEMP_DIR, `audio-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp3`);
  try {
    const args = ['-y'];
    if (startSec > 0) {
      args.push('-ss', String(startSec));
    }
    if (durationSec && durationSec > 0) {
      args.push('-t', String(durationSec));
    }
    args.push(
      '-i',
      videoPath,
      '-vn',
      '-acodec',
      'libmp3lame',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-b:a',
      '24k',
      outMp3
    );
    await runProcess('ffmpeg', args);
    return await fs.readFile(outMp3);
  } finally {
    await fs.unlink(outMp3).catch(() => {});
  }
}

export async function extractAudioForAi(videoPath: string, tag: string): Promise<Buffer> {
  return extractAudioChunkForAi(videoPath, tag, 0);
}

export async function extractKeyframesForAi(
  videoPath: string,
  tag: string,
  durationSec: number,
  maxFrames = 8
): Promise<Array<{ timestampSec: number; jpegBuffer: Buffer }>> {
  await ensureStorageDirectories();
  const safeDur = Math.max(1, durationSec);
  const frameCount = Math.min(maxFrames, Math.max(3, Math.ceil(safeDur / 4)));
  const timestamps = Array.from({ length: frameCount }, (_, i) => {
    const ratio = frameCount === 1 ? 0.5 : i / (frameCount - 1);
    return Math.min(Math.max(0, safeDur - 0.3), Number((ratio * safeDur).toFixed(2)));
  });

  const t0 = Date.now();
  const results = await runWithConcurrency<
    number,
    { timestampSec: number; jpegBuffer: Buffer } | null
  >(timestamps, 4, async (ts, i) => {
    const outImg = path.join(TEMP_DIR, `frame-${tag}-${i}-${Date.now()}.jpg`);
    try {
      await runProcess('ffmpeg', [
        '-y',
        '-ss',
        String(ts),
        '-i',
        videoPath,
        '-frames:v',
        '1',
        '-vf',
        'scale=640:-2',
        '-q:v',
        '6',
        outImg,
      ]);
      const jpegBuffer: Buffer = await fs.readFile(outImg);
      return jpegBuffer.length > 0 ? { timestampSec: ts, jpegBuffer } : null;
    } catch {
      return null;
    } finally {
      await fs.unlink(outImg).catch(() => {});
    }
  });

  const frames = results.filter((r): r is { timestampSec: number; jpegBuffer: Buffer } => r !== null);
  console.info(`[FFmpeg] Extracted ${frames.length}/${frameCount} keyframes tag=${tag} in ${Date.now() - t0}ms`);
  return frames;
}

export async function ensureSampleVideoExists(sampleId: string): Promise<string> {
  await ensureStorageDirectories();
  const sample = STUDIO_SAMPLES.find((s) => s.id === sampleId) ?? STUDIO_SAMPLES[0];
  const outputPath = path.join(SAMPLES_DIR, `${sample.id}.mp4`);

  try {
    const stat = await fs.stat(outputPath);
    if (stat.size > 20_000) {
      return outputPath;
    }
  } catch {
    // Not generated yet
  }

  const existingLock = sampleGenerationLocks.get(sample.id);
  if (existingLock) {
    return existingLock;
  }

  const job = (async () => {
    const imageRel = sample.thumbnailUrl.replace(/^\/+/, '');
    const imagePath = path.resolve(process.cwd(), imageRel);
    const wavTempPath = path.join(TEMP_DIR, `sample-${sample.id}-${Date.now()}.wav`);

    try {
      const ttsWav = await synthesizeSampleSpeechWav(sample.id);
      if (ttsWav && ttsWav.length > 1000) {
        await fs.writeFile(wavTempPath, ttsWav);
        await runProcess('ffmpeg', [
          '-y',
          '-loop',
          '1',
          '-i',
          imagePath,
          '-i',
          wavTempPath,
          '-filter_complex',
          '[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,format=yuv420p[bg];[1:a]showwaves=s=1280x88:mode=cline:colors=0x38bdf8@0.9|0x818cf8@0.7[wave];[bg][wave]overlay=0:H-110:shortest=1[v]',
          '-map',
          '[v]',
          '-map',
          '1:a',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-r',
          '24',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          outputPath,
        ]);
      } else {
        await runProcess('ffmpeg', [
          '-y',
          '-loop',
          '1',
          '-t',
          String(sample.durationSec),
          '-i',
          imagePath,
          '-f',
          'lavfi',
          '-t',
          String(sample.durationSec),
          '-i',
          'sine=frequency=220:sample_rate=44100',
          '-filter_complex',
          '[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,format=yuv420p[bg];[1:a]volume=0.08,showwaves=s=1280x88:mode=cline:colors=0x38bdf8@0.85[wave];[bg][wave]overlay=0:H-110:shortest=1[v]',
          '-map',
          '[v]',
          '-map',
          '1:a',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-r',
          '24',
          '-c:a',
          'aac',
          '-b:a',
          '128k',
          '-movflags',
          '+faststart',
          outputPath,
        ]);
      }
      return outputPath;
    } finally {
      await fs.unlink(wavTempPath).catch(() => {});
      sampleGenerationLocks.delete(sample.id);
    }
  })();

  sampleGenerationLocks.set(sample.id, job);
  return job;
}

export interface RenderClipOptions {
  clipId: number;
  sourceFilePath: string;
  startSec: number;
  endSec: number;
  aspectRatio: AspectRatio;
  resolution: ExportResolution;
  captionStyle: CaptionStyle;
  videoTheme?: VideoTheme;
  fontFamily: string;
  highlightColor: string;
  cropX: number;
  enhanceAudio: boolean;
  trimSilence: boolean;
  bgMusic: boolean;
  includeIntroOutro: boolean;
  captions: CaptionLine[];
}

export async function renderClipMp4(
  opts: RenderClipOptions
): Promise<{ renderPath: string; fileSizeBytes: number; durationSec: number }> {
  await ensureStorageDirectories();
  const startedAt = Date.now();
  const probe = await probeVideoMetadata(opts.sourceFilePath);
  const clamped = clampClipWindow(opts.startSec, opts.endSec, probe.durationSec, 1.5);
  const durationSec = clamped.durationSec;

  const validCaptions = (opts.captions || []).filter(
    (c) => c.text && c.text.trim().length > 0 && c.end > c.start
  );
  const hasCaptions = validCaptions.length > 0;
  const assPath = path.join(TEMP_DIR, `clip-${opts.clipId}-${Date.now()}.ass`);
  const outPath = path.join(
    RENDERS_DIR,
    `clip-${opts.clipId}-${opts.aspectRatio.replace(':', 'x')}-${opts.resolution}-${Date.now()}.mp4`
  );

  if (hasCaptions) {
    const assContent = buildAssSubtitles({
      captions: validCaptions,
      aspectRatio: opts.aspectRatio,
      resolution: opts.resolution,
      captionStyle: opts.captionStyle,
      fontFamily: opts.fontFamily,
      highlightColor: opts.highlightColor,
    });
    await fs.writeFile(assPath, assContent, 'utf8');
  }

  const executeFfmpegRender = async (allowTrimSilence: boolean) => {
    let videoFilter = buildVideoFilterGraph({
      aspectRatio: opts.aspectRatio,
      resolution: opts.resolution,
      cropX: opts.cropX,
      videoTheme: opts.videoTheme,
      assFilePath: hasCaptions ? assPath : undefined,
    });

    if (opts.includeIntroOutro && durationSec > 4) {
      videoFilter += `,fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(0.5, durationSec - 0.35).toFixed(2)}:d=0.35`;
    }

    const args: string[] = [
      '-y',
      '-ss',
      String(clamped.startSec),
      '-t',
      String(durationSec),
      '-i',
      opts.sourceFilePath,
    ];

    if (opts.bgMusic) {
      args.push(
        '-f',
        'lavfi',
        '-t',
        String(durationSec),
        '-i',
        'sine=frequency=146.83:sample_rate=44100'
      );
    }

    if (probe.hasAudio) {
      if (opts.bgMusic) {
        const voiceFilters: string[] = [];
        if (opts.enhanceAudio) voiceFilters.push('dynaudnorm=f=150:g=15:p=0.9:m=10');
        if (allowTrimSilence && opts.trimSilence) {
          voiceFilters.push(
            `silenceremove=start_periods=1:start_silence=0.3:start_threshold=-45dB:detection=peak,apad=whole_dur=${durationSec}`
          );
        }
        const voiceChain = voiceFilters.length ? `,${voiceFilters.join(',')}` : '';
        args.push(
          '-filter_complex',
          `[0:v:0]${videoFilter}[vout];[0:a:0]aformat=sample_rates=44100:channel_layouts=stereo${voiceChain}[voice];[1:a:0]volume=0.04,afade=t=in:st=0:d=0.6,afade=t=out:st=${Math.max(0.5, durationSec - 0.6).toFixed(2)}:d=0.6[pad];[voice][pad]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
          '-map',
          '[vout]',
          '-map',
          '[aout]',
          '-c:a',
          'aac',
          '-b:a',
          '128k'
        );
      } else {
        args.push('-vf', videoFilter);
        const audioFilters: string[] = [];
        if (opts.enhanceAudio) audioFilters.push('dynaudnorm=f=150:g=15:p=0.9:m=10');
        if (allowTrimSilence && opts.trimSilence) {
          audioFilters.push(
            `silenceremove=start_periods=1:start_silence=0.3:start_threshold=-45dB:detection=peak,apad=whole_dur=${durationSec}`
          );
        }
        if (audioFilters.length > 0) {
          args.push('-af', audioFilters.join(','));
        }
        args.push('-map', '0:v:0', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k');
      }
    } else if (opts.bgMusic) {
      args.push(
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-af',
        `volume=0.06,afade=t=in:st=0:d=0.6,afade=t=out:st=${Math.max(0.5, durationSec - 0.6).toFixed(2)}:d=0.6`,
        '-c:a',
        'aac',
        '-b:a',
        '128k'
      );
    } else {
      args.push('-map', '0:v:0', '-an');
    }

    args.push(
      '-t',
      String(durationSec),
      '-threads',
      '2',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outPath
    );

    await runProcess('ffmpeg', args);
  };

  try {
    try {
      await executeFfmpegRender(true);
    } catch (firstErr) {
      if (opts.trimSilence) {
        console.warn(`[FFmpeg] Clip ${opts.clipId} retrying render without silenceremove:`, firstErr);
        await fs.unlink(outPath).catch(() => {});
        await executeFfmpegRender(false);
      } else {
        throw firstErr;
      }
    }

    const stat = await fs.stat(outPath);
    if (stat.size < 1024) {
      throw new Error('Rendered MP4 output was empty.');
    }

    console.info(
      `[FFmpeg] Rendered clip=${opts.clipId} ${opts.aspectRatio} ${opts.resolution} theme=${opts.videoTheme || 'Original'} dur=${durationSec}s size=${stat.size}B in ${Date.now() - startedAt}ms`
    );

    return {
      renderPath: outPath,
      fileSizeBytes: stat.size,
      durationSec,
    };
  } finally {
    if (hasCaptions) {
      await fs.unlink(assPath).catch(() => {});
    }
  }
}

export async function renderYouTubeMotionClipMp4(opts: {
  clipId: number;
  thumbnailUrl: string;
  youtubeId: string;
  startSec: number;
  endSec: number;
  aspectRatio: AspectRatio;
  resolution: ExportResolution;
  captionStyle: CaptionStyle;
  videoTheme?: VideoTheme;
  fontFamily: string;
  highlightColor: string;
  cropX: number;
  bgMusic: boolean;
  includeIntroOutro: boolean;
  captions: CaptionLine[];
}): Promise<{ renderPath: string; fileSizeBytes: number; durationSec: number }> {
  await ensureStorageDirectories();
  const startedAt = Date.now();
  const durationSec = Number(Math.max(2, Math.min(90, opts.endSec - opts.startSec)).toFixed(2));
  const { width, height } = getTargetDimensions(opts.aspectRatio, opts.resolution);
  const themeMeta = getVideoThemeMeta(normalizeVideoTheme(opts.videoTheme));

  const fallbackThumb = path.resolve(
    process.cwd(),
    'src/assets/images/hero_studio_preview_1794825184394.jpg'
  );
  const tempThumb = path.join(TEMP_DIR, `yt-thumb-${opts.clipId}-${Date.now()}.jpg`);
  let thumbInputPath = fallbackThumb;
  let downloadedTempThumb = false;

  const candidateUrl =
    opts.thumbnailUrl && /^https?:\/\//i.test(opts.thumbnailUrl)
      ? opts.thumbnailUrl
      : opts.youtubeId
        ? `https://i.ytimg.com/vi/${opts.youtubeId}/hqdefault.jpg`
        : '';

  if (candidateUrl) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(candidateUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const arrBuf = await res.arrayBuffer();
        if (arrBuf.byteLength > 1000) {
          await fs.writeFile(tempThumb, Buffer.from(arrBuf));
          thumbInputPath = tempThumb;
          downloadedTempThumb = true;
        }
      }
    } catch {
      // Fallback to local studio backdrop asset cleanly
    }
  }

  const validCaptions = (opts.captions || []).filter(
    (c) => c.text && c.text.trim().length > 0 && c.end > c.start
  );
  const hasCaptions = validCaptions.length > 0;
  const assPath = path.join(TEMP_DIR, `yt-clip-${opts.clipId}-${Date.now()}.ass`);
  const outPath = path.join(
    RENDERS_DIR,
    `yt-clip-${opts.clipId}-${opts.aspectRatio.replace(':', 'x')}-${opts.resolution}-${Date.now()}.mp4`
  );

  if (hasCaptions) {
    const assContent = buildAssSubtitles({
      captions: validCaptions,
      aspectRatio: opts.aspectRatio,
      resolution: opts.resolution,
      captionStyle: opts.captionStyle,
      fontFamily: opts.fontFamily,
      highlightColor: opts.highlightColor,
    });
    await fs.writeFile(assPath, assContent, 'utf8');
  }

  try {
    const clampedX = Math.max(0, Math.min(1, Number.isFinite(opts.cropX) ? opts.cropX : 0.5));
    const ratioExpr = `${width}/${height}`;
    const filters: string[] = [
      `crop='min(iw,ih*${ratioExpr})':'min(ih,iw/(${ratioExpr}))':'(iw-ow)*${clampedX.toFixed(3)}':'(ih-oh)/2'`,
      `scale=${width}:${height}:flags=bicubic,setsar=1,format=yuv420p`,
    ];

    if (themeMeta.ffmpegFilter) {
      filters.push(themeMeta.ffmpegFilter);
    }

    if (hasCaptions) {
      const escapedAss = assPath
        .replace(/\\/g, '/')
        .replace(/:/g, '\\:')
        .replace(/'/g, "\\'");
      filters.push(`ass='${escapedAss}'`);
    }

    if (opts.includeIntroOutro && durationSec > 3) {
      filters.push(`fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(0.5, durationSec - 0.35).toFixed(2)}:d=0.35`);
    }

    const args = [
      '-y',
      '-loop',
      '1',
      '-t',
      String(durationSec),
      '-i',
      thumbInputPath,
      '-f',
      'lavfi',
      '-t',
      String(durationSec),
      '-i',
      'sine=frequency=146.83:sample_rate=44100',
      '-filter_complex',
      `[0:v]${filters.join(',')}[v];[1:a]volume=${opts.bgMusic ? '0.06' : '0.02'},afade=t=in:st=0:d=0.4,afade=t=out:st=${Math.max(0.4, durationSec - 0.5).toFixed(2)}:d=0.5[a]`,
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-r',
      '24',
      '-threads',
      '2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-crf',
      '23',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outPath,
    ];

    await runProcess('ffmpeg', args);
    const stat = await fs.stat(outPath);
    if (stat.size < 1024) {
      throw new Error('Generated MP4 reel output was empty.');
    }

    console.info(
      `[FFmpeg] Rendered YouTube Motion Reel clip=${opts.clipId} ${opts.aspectRatio} ${opts.resolution} theme=${themeMeta.id} dur=${durationSec}s size=${stat.size}B in ${Date.now() - startedAt}ms`
    );

    return {
      renderPath: outPath,
      fileSizeBytes: stat.size,
      durationSec,
    };
  } finally {
    if (downloadedTempThumb) {
      await fs.unlink(tempThumb).catch(() => {});
    }
    if (hasCaptions) {
      await fs.unlink(assPath).catch(() => {});
    }
  }
}
