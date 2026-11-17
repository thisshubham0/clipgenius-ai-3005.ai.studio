import fs from 'node:fs/promises';
import {
  getProjectByIdForUser,
  replaceClipsForProject,
  updateClipRow,
  updateProjectRow,
} from '../db/queries.ts';
import { deductUserCredits } from '../db/users.ts';
import type { JobProgress, ProjectConfig, TranscriptSegment } from '../shared/types.ts';
import { runWithConcurrency } from '../utils/pipelineResilience.ts';
import {
  analyzeVideoFramesToMoments,
  analyzeYouTubeVideoWithGemini,
  detectEngagingMoments,
  type DetectedClipMoment,
  transcribeAudioToSegments,
} from './geminiService.ts';
import {
  extractAllAudioChunksForAi,
  extractKeyframesForAi,
  probeVideoMetadata,
  renderClipMp4,
  resolveProjectSourceFile,
  SAMPLE_SCRIPTS,
} from './mediaPipeline.ts';

interface QueuedJob {
  projectId: number;
  userId: number;
  config: ProjectConfig;
}

const MAX_CONCURRENT_JOBS = 2;
const activeJobs = new Map<number, JobProgress>();
const runningProjectIds = new Set<number>();
const pendingQueue: QueuedJob[] = [];
let activeWorkerCount = 0;

export function getJobProgress(projectId: number): JobProgress | null {
  return activeJobs.get(projectId) ?? null;
}

function setProgress(
  projectId: number,
  stage: JobProgress['stage'],
  percent: number,
  message: string
) {
  activeJobs.set(projectId, {
    projectId,
    stage,
    percent,
    message,
    updatedAt: Date.now(),
  });
}

function drainQueue() {
  while (activeWorkerCount < MAX_CONCURRENT_JOBS && pendingQueue.length > 0) {
    const next = pendingQueue.shift()!;
    activeWorkerCount += 1;
    void runProjectPipeline(next)
      .catch((err) => {
        console.error(`[Pipeline project=${next.projectId}] Unhandled error:`, err);
      })
      .finally(() => {
        activeWorkerCount = Math.max(0, activeWorkerCount - 1);
        runningProjectIds.delete(next.projectId);
        drainQueue();
      });
  }
}

export function enqueueProjectPipeline(params: {
  projectId: number;
  userId: number;
  config: ProjectConfig;
}): { alreadyRunning: boolean; progress: JobProgress } {
  if (runningProjectIds.has(params.projectId)) {
    const existing =
      activeJobs.get(params.projectId) ?? {
        projectId: params.projectId,
        stage: 'queued',
        percent: 5,
        message: 'Pipeline is already running for this project...',
        updatedAt: Date.now(),
      };
    return { alreadyRunning: true, progress: existing };
  }

  runningProjectIds.add(params.projectId);
  setProgress(
    params.projectId,
    'queued',
    5,
    activeWorkerCount >= MAX_CONCURRENT_JOBS
      ? `Queued behind ${activeWorkerCount} active video job(s)...`
      : 'Queued for AI analysis and clip generation...'
  );

  pendingQueue.push(params);
  drainQueue();

  return {
    alreadyRunning: false,
    progress: activeJobs.get(params.projectId)!,
  };
}

async function runProjectPipeline(params: QueuedJob) {
  const { projectId, userId, config } = params;
  const pipelineStartedAt = Date.now();

  try {
    const project = await getProjectByIdForUser(projectId, userId);
    if (!project) {
      setProgress(projectId, 'error', 0, 'Project not found.');
      return;
    }

    if (!project.sourceFilePath && project.sourceType !== 'sample' && project.sourceType !== 'youtube') {
      const msg =
        'No authorized media file attached. Paste a public YouTube link, upload an MP4/MOV/WebM video, or choose an authorized studio sample.';
      await updateProjectRow(projectId, userId, { status: 'error', errorMessage: msg });
      setProgress(projectId, 'error', 0, msg);
      return;
    }

    await updateProjectRow(projectId, userId, {
      status: 'analyzing',
      errorMessage: '',
      configJson: JSON.stringify(config),
    });

    // Path A: Direct YouTube URL analysis via Gemini Multimodal AI (when no local MP4 is attached)
    if (project.sourceType === 'youtube' && !project.sourceFilePath) {
      setProgress(
        projectId,
        'acquiring_media',
        18,
        'Connecting Gemini Multimodal AI to YouTube video...'
      );
      setProgress(
        projectId,
        'transcribing',
        42,
        'Transcribing dialogue & detecting viral clip moments from YouTube...'
      );

      const ytResult = await analyzeYouTubeVideoWithGemini({
        youtubeUrl: project.sourceUrl,
        title: project.title,
        channelName: project.channelName || 'YouTube Creator',
        config,
      });

      await updateProjectRow(projectId, userId, {
        durationSec: ytResult.durationSec,
        transcriptJson: JSON.stringify(ytResult.transcript),
        status: 'analyzed',
      });

      setProgress(
        projectId,
        'analyzing_moments',
        78,
        `Saving ${ytResult.moments.length} timestamped clips with synchronized captions...`
      );

      await replaceClipsForProject(
        projectId,
        userId,
        ytResult.moments.map((m) => ({
          projectId,
          userId,
          title: m.title,
          hook: m.hook,
          description: m.description,
          hashtags: m.hashtags,
          startSec: m.startSec,
          endSec: m.endSec,
          durationSec: Number(Math.max(1.5, m.endSec - m.startSec).toFixed(2)),
          aspectRatio: config.aspectRatio,
          captionStyle: config.captionStyle,
          videoTheme: config.videoTheme || 'Original',
          fontFamily: 'Plus Jakarta Sans',
          highlightColor: '#38BDF8',
          cropX: 0.5,
          enhanceAudio: config.enhanceAudio,
          trimSilence: config.trimSilence,
          bgMusic: config.bgMusic,
          includeIntroOutro: config.includeIntroOutro,
          viralScore: m.viralScore,
          scoreBreakdownJson: JSON.stringify(m.scoreBreakdown),
          captionsJson: JSON.stringify(m.captions),
          renderStatus: 'pending',
          renderResolution: config.resolution,
          fileSizeBytes: 0,
        }))
      );

      await deductUserCredits(userId, ytResult.moments.length);
      await updateProjectRow(projectId, userId, { status: 'completed', errorMessage: '' });
      console.info(
        `[Pipeline project=${projectId}] COMPLETED youtube-ai clips=${ytResult.moments.length} totalElapsed=${Date.now() - pipelineStartedAt}ms`
      );
      setProgress(
        projectId,
        'completed',
        100,
        `Generated ${ytResult.moments.length} timestamped YouTube clips & captions.`
      );
      return;
    }

    setProgress(projectId, 'acquiring_media', 12, 'Inspecting video stream and frame dimensions...');
    const tProbe = Date.now();
    const resolvedSourcePath = await resolveProjectSourceFile(
      project.sourceType,
      project.sourceFilePath
    );
    if (resolvedSourcePath !== project.sourceFilePath) {
      await updateProjectRow(projectId, userId, { sourceFilePath: resolvedSourcePath });
    }

    const probe = await probeVideoMetadata(resolvedSourcePath);
    const durationSec = probe.durationSec;
    console.info(
      `[Pipeline project=${projectId}] stage=acquiring_media dur=${durationSec.toFixed(2)}s hasAudio=${probe.hasAudio} in ${Date.now() - tProbe}ms`
    );

    await updateProjectRow(projectId, userId, { durationSec });

    let transcript: TranscriptSegment[] = [];
    try {
      transcript = JSON.parse(project.transcriptJson || '[]') as TranscriptSegment[];
    } catch {
      transcript = [];
    }

    let predetectedMoments: DetectedClipMoment[] | null = null;
    const matchedSampleKey = Object.keys(SAMPLE_SCRIPTS).find((k) =>
      resolvedSourcePath.includes(`${k}.mp4`)
    );

    if (transcript.length === 0) {
      if (probe.hasAudio) {
        setProgress(projectId, 'extracting_audio', 22, 'Extracting audio track with FFmpeg...');
        const tExtract = Date.now();
        const chunks = await extractAllAudioChunksForAi(
          resolvedSourcePath,
          `proj-${projectId}`,
          durationSec,
          720
        );
        console.info(
          `[Pipeline project=${projectId}] stage=extracting_audio chunks=${chunks.length} in ${Date.now() - tExtract}ms`
        );

        if (chunks.length > 0) {
          let completedChunks = 0;
          setProgress(
            projectId,
            'transcribing',
            36,
            chunks.length > 1
              ? `Transcribing ${chunks.length} audio segments concurrently with Gemini Speech-to-Text...`
              : 'Generating timestamped transcript with Gemini Speech-to-Text...'
          );

          try {
            const tStt = Date.now();
            const chunkResults = await runWithConcurrency(chunks, 3, async (chunk) => {
              const segs = await transcribeAudioToSegments({
                audioBuffer: chunk.buffer,
                mimeType: 'audio/mp3',
                durationSec: chunk.durationSec,
                offsetSec: chunk.startSec,
                videoTitle: project.title,
              });
              completedChunks += 1;
              const pct = Math.round(36 + (completedChunks / chunks.length) * 20);
              setProgress(
                projectId,
                'transcribing',
                pct,
                chunks.length > 1
                  ? `Transcribed ${completedChunks} of ${chunks.length} audio segments...`
                  : 'Timestamped transcript complete.'
              );
              return segs;
            });
            transcript = chunkResults.flat().sort((a, b) => a.start - b.start);
            console.info(
              `[Pipeline project=${projectId}] stage=transcribing segments=${transcript.length} in ${Date.now() - tStt}ms`
            );
          } catch (sttErr) {
            if (matchedSampleKey) {
              console.warn(
                `[Pipeline project=${projectId}] Studio sample STT fell back to authored script:`,
                sttErr instanceof Error ? sttErr.message : sttErr
              );
              transcript = SAMPLE_SCRIPTS[matchedSampleKey];
            } else {
              throw sttErr;
            }
          }
        }
      }

      if (transcript.length === 0) {
        if (matchedSampleKey) {
          transcript = SAMPLE_SCRIPTS[matchedSampleKey];
        } else {
          setProgress(
            projectId,
            'analyzing_moments',
            56,
            'No spoken dialogue detected — analyzing video keyframes with Gemini Vision...'
          );
          const tFrames = Date.now();
          const frames = await extractKeyframesForAi(
            resolvedSourcePath,
            `proj-${projectId}`,
            durationSec,
            8
          );
          if (frames.length === 0) {
            throw new Error('Could not extract readable video frames from this file.');
          }
          const visualResult = await analyzeVideoFramesToMoments({
            title: project.title,
            durationSec,
            frames,
            config,
          });
          console.info(
            `[Pipeline project=${projectId}] stage=visual_keyframes moments=${visualResult.moments.length} in ${Date.now() - tFrames}ms`
          );
          transcript = visualResult.transcript;
          predetectedMoments = visualResult.moments;
        }
      }

      await updateProjectRow(projectId, userId, {
        transcriptJson: JSON.stringify(transcript),
        status: 'analyzed',
      });
    }

    let moments: DetectedClipMoment[];
    if (predetectedMoments && predetectedMoments.length > 0) {
      moments = predetectedMoments;
    } else {
      const tMoments = Date.now();
      setProgress(projectId, 'analyzing_moments', 62, 'Detecting viral hooks and optimal clip boundaries...');
      moments = await detectEngagingMoments({
        title: project.title,
        durationSec,
        transcript,
        config,
      });
      console.info(
        `[Pipeline project=${projectId}] stage=analyzing_moments moments=${moments.length} in ${Date.now() - tMoments}ms`
      );
    }

    await updateProjectRow(projectId, userId, { status: 'generating' });

    const insertedClips = await replaceClipsForProject(
      projectId,
      userId,
      moments.map((m) => ({
        projectId,
        userId,
        title: m.title,
        hook: m.hook,
        description: m.description,
        hashtags: m.hashtags,
        startSec: m.startSec,
        endSec: m.endSec,
        durationSec: Number(Math.max(1.5, m.endSec - m.startSec).toFixed(2)),
        aspectRatio: config.aspectRatio,
        captionStyle: config.captionStyle,
        videoTheme: config.videoTheme || 'Original',
        fontFamily: 'Plus Jakarta Sans',
        highlightColor: '#38BDF8',
        cropX: 0.5,
        enhanceAudio: config.enhanceAudio,
        trimSilence: config.trimSilence,
        bgMusic: config.bgMusic,
        includeIntroOutro: config.includeIntroOutro,
        viralScore: m.viralScore,
        scoreBreakdownJson: JSON.stringify(m.scoreBreakdown),
        captionsJson: JSON.stringify(m.captions),
        renderStatus: 'rendering',
        renderResolution: config.resolution,
        fileSizeBytes: 0,
      }))
    );

    const total = Math.max(1, insertedClips.length);
    let completedRenders = 0;
    let readyCount = 0;
    let lastRenderError = '';
    const tRenderAll = Date.now();

    setProgress(
      projectId,
      'rendering_clips',
      70,
      `Rendering ${total} clips (${config.aspectRatio} · ${config.captionStyle} captions)...`
    );

    await runWithConcurrency(insertedClips, 2, async (clip) => {
      try {
        const captions = JSON.parse(clip.captionsJson || '[]');
        const rendered = await renderClipMp4({
          clipId: clip.id,
          sourceFilePath: resolvedSourcePath,
          startSec: clip.startSec,
          endSec: clip.endSec,
          aspectRatio: config.aspectRatio,
          resolution: config.resolution,
          captionStyle: config.captionStyle,
          videoTheme: config.videoTheme || 'Original',
          fontFamily: clip.fontFamily,
          highlightColor: clip.highlightColor,
          cropX: clip.cropX,
          enhanceAudio: clip.enhanceAudio,
          trimSilence: clip.trimSilence,
          bgMusic: clip.bgMusic,
          includeIntroOutro: clip.includeIntroOutro,
          captions,
        });

        const prevRenderPath = clip.renderPath;
        await updateClipRow(clip.id, userId, {
          renderPath: rendered.renderPath,
          renderStatus: 'ready',
          fileSizeBytes: rendered.fileSizeBytes,
          durationSec: rendered.durationSec,
        });
        if (prevRenderPath && prevRenderPath !== rendered.renderPath) {
          await fs.unlink(prevRenderPath).catch(() => {});
        }
        readyCount += 1;
      } catch (renderErr) {
        lastRenderError = renderErr instanceof Error ? renderErr.message : String(renderErr);
        console.error(`[Pipeline project=${projectId}] Failed rendering clip=${clip.id}:`, renderErr);
        await updateClipRow(clip.id, userId, { renderStatus: 'error' });
      } finally {
        completedRenders += 1;
        const pct = Math.round(70 + (completedRenders / total) * 27);
        setProgress(
          projectId,
          'rendering_clips',
          pct,
          `Rendered ${completedRenders} of ${total} clips (${config.aspectRatio} · ${config.captionStyle})...`
        );
      }
    });

    console.info(
      `[Pipeline project=${projectId}] stage=rendering_clips ready=${readyCount}/${total} in ${Date.now() - tRenderAll}ms`
    );

    if (readyCount === 0) {
      throw new Error(
        lastRenderError
          ? `Clip rendering failed: ${lastRenderError}`
          : 'All clip renders failed. Verify the uploaded video codec and retry.'
      );
    }

    await deductUserCredits(userId, readyCount * 2);
    await updateProjectRow(projectId, userId, { status: 'completed', errorMessage: '' });
    console.info(
      `[Pipeline project=${projectId}] COMPLETED ready=${readyCount} totalElapsed=${Date.now() - pipelineStartedAt}ms`
    );
    setProgress(projectId, 'completed', 100, `Generated ${readyCount} ready-to-export clips.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected video processing error.';
    console.error(
      `[Pipeline project=${projectId}] FAILED after ${Date.now() - pipelineStartedAt}ms:`,
      message
    );
    await updateProjectRow(projectId, userId, {
      status: 'error',
      errorMessage: message,
    }).catch(() => {});
    setProgress(projectId, 'error', 0, message);
  }
}
