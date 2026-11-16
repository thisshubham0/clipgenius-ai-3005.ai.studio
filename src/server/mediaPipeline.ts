import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AspectRatio,
  CaptionLine,
  CaptionStyle,
  ExportResolution,
  StudioSample,
} from '../shared/types.ts';
import { buildAssSubtitles, buildVideoFilterGraph } from '../utils/ffmpegArgs.ts';
import { synthesizeSampleSpeechWav } from './geminiService.ts';

const STORAGE_ROOT = path.resolve(process.cwd(), 'storage');
const SAMPLES_DIR = path.join(STORAGE_ROOT, 'samples');
const UPLOADS_DIR = path.join(STORAGE_ROOT, 'uploads');
const RENDERS_DIR = path.join(STORAGE_ROOT, 'renders');
const TEMP_DIR = path.join(STORAGE_ROOT, 'tmp');

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
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');
  const durationSec = Number(parsed.format?.duration ?? 0);

  return {
    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 15,
    width: videoStream?.width ?? 1280,
    height: videoStream?.height ?? 720,
    hasAudio: Boolean(audioStream),
  };
}

export async function extractAudioForAi(videoPath: string, tag: string): Promise<Buffer> {
  await ensureStorageDirectories();
  const outMp3 = path.join(TEMP_DIR, `audio-${tag}-${Date.now()}.mp3`);
  try {
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
      '48k',
      outMp3,
    ]);
    return await fs.readFile(outMp3);
  } finally {
    await fs.unlink(outMp3).catch(() => {});
  }
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
      // Deterministic synthesized audio tone bed if TTS is unavailable
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
  }
}

export interface RenderClipOptions {
  clipId: number;
  sourceFilePath: string;
  startSec: number;
  endSec: number;
  aspectRatio: AspectRatio;
  resolution: ExportResolution;
  captionStyle: CaptionStyle;
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
  const durationSec = Math.max(2, Number((opts.endSec - opts.startSec).toFixed(2)));
  const assPath = path.join(TEMP_DIR, `clip-${opts.clipId}-${Date.now()}.ass`);
  const outPath = path.join(
    RENDERS_DIR,
    `clip-${opts.clipId}-${opts.aspectRatio.replace(':', 'x')}-${opts.resolution}.mp4`
  );

  const assContent = buildAssSubtitles({
    captions: opts.captions,
    aspectRatio: opts.aspectRatio,
    resolution: opts.resolution,
    captionStyle: opts.captionStyle,
    fontFamily: opts.fontFamily,
    highlightColor: opts.highlightColor,
  });

  await fs.writeFile(assPath, assContent, 'utf8');

  try {
    const probe = await probeVideoMetadata(opts.sourceFilePath);
    let videoFilter = buildVideoFilterGraph({
      aspectRatio: opts.aspectRatio,
      resolution: opts.resolution,
      cropX: opts.cropX,
      assFilePath: assPath,
    });

    if (opts.includeIntroOutro && durationSec > 4) {
      videoFilter += `,fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(0.5, durationSec - 0.35).toFixed(2)}:d=0.35`;
    }

    const args: string[] = [
      '-y',
      '-ss',
      String(Math.max(0, opts.startSec)),
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

    args.push('-vf', videoFilter);

    if (probe.hasAudio) {
      if (opts.bgMusic) {
        const voiceFilters: string[] = [];
        if (opts.enhanceAudio) voiceFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
        if (opts.trimSilence) voiceFilters.push('silenceremove=start_periods=1:start_threshold=-42dB:detection=peak');
        const voiceChain = voiceFilters.length ? `,${voiceFilters.join(',')}` : '';
        args.push(
          '-filter_complex',
          `[0:a]aformat=sample_rates=44100:channel_layouts=stereo${voiceChain}[voice];[1:a]volume=0.04,afade=t=in:st=0:d=0.6,afade=t=out:st=${Math.max(0.5, durationSec - 0.6).toFixed(2)}:d=0.6[pad];[voice][pad]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
          '-map',
          '0:v:0',
          '-map',
          '[aout]'
        );
      } else {
        const audioFilters: string[] = [];
        if (opts.enhanceAudio) audioFilters.push('loudnorm=I=-16:TP=-1.5:LRA=11');
        if (opts.trimSilence) audioFilters.push('silenceremove=start_periods=1:start_threshold=-42dB:detection=peak');
        if (audioFilters.length > 0) {
          args.push('-af', audioFilters.join(','));
        }
      }
      args.push('-c:a', 'aac', '-b:a', '128k');
    } else {
      args.push('-an');
    }

    args.push(
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
    const stat = await fs.stat(outPath);
    return {
      renderPath: outPath,
      fileSizeBytes: stat.size,
      durationSec,
    };
  } finally {
    await fs.unlink(assPath).catch(() => {});
  }
}
