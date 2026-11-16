import {
  getProjectByIdForUser,
  replaceClipsForProject,
  updateClipRow,
  updateProjectRow,
} from '../db/queries.ts';
import { deductUserCredits } from '../db/users.ts';
import type { JobProgress, ProjectConfig, TranscriptSegment } from '../shared/types.ts';
import {
  detectEngagingMoments,
  transcribeAudioToSegments,
} from './geminiService.ts';
import {
  extractAudioForAi,
  probeVideoMetadata,
  renderClipMp4,
  SAMPLE_SCRIPTS,
} from './mediaPipeline.ts';

const activeJobs = new Map<number, JobProgress>();

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

export function enqueueProjectPipeline(params: {
  projectId: number;
  userId: number;
  config: ProjectConfig;
}) {
  setProgress(params.projectId, 'queued', 5, 'Queued for AI analysis and video rendering...');

  void runProjectPipeline(params).catch((err) => {
    console.error(`Pipeline failed for project ${params.projectId}:`, err);
  });
}

async function runProjectPipeline(params: {
  projectId: number;
  userId: number;
  config: ProjectConfig;
}) {
  const { projectId, userId, config } = params;

  try {
    const project = await getProjectByIdForUser(projectId, userId);
    if (!project) {
      setProgress(projectId, 'error', 0, 'Project not found.');
      return;
    }

    if (!project.sourceFilePath) {
      const msg =
        'No authorized media file attached. Upload an MP4/MOV video or choose an authorized studio sample.';
      await updateProjectRow(projectId, userId, { status: 'error', errorMessage: msg });
      setProgress(projectId, 'error', 0, msg);
      return;
    }

    await updateProjectRow(projectId, userId, {
      status: 'analyzing',
      errorMessage: '',
      configJson: JSON.stringify(config),
    });

    setProgress(projectId, 'acquiring_media', 15, 'Inspecting video stream and frame dimensions...');
    const probe = await probeVideoMetadata(project.sourceFilePath);
    const durationSec = probe.durationSec;

    await updateProjectRow(projectId, userId, { durationSec });

    let transcript: TranscriptSegment[] = [];
    try {
      transcript = JSON.parse(project.transcriptJson || '[]') as TranscriptSegment[];
    } catch {
      transcript = [];
    }

    if (transcript.length === 0) {
      if (!probe.hasAudio) {
        throw new Error('The source video has no audio track to transcribe.');
      }

      setProgress(projectId, 'extracting_audio', 28, 'Extracting mono audio track with FFmpeg...');
      const audioBuffer = await extractAudioForAi(project.sourceFilePath, `proj-${projectId}`);

      setProgress(projectId, 'transcribing', 45, 'Generating timestamped transcript with Gemini Speech-to-Text...');
      try {
        transcript = await transcribeAudioToSegments({
          audioBuffer,
          mimeType: 'audio/mp3',
          durationSec,
          videoTitle: project.title,
        });
      } catch (sttErr) {
        // If this is a bundled Studio Sample whose TTS audio fell back to ambient tone, use its authored studio script
        const matchedSampleKey = Object.keys(SAMPLE_SCRIPTS).find((k) =>
          project.sourceFilePath.includes(`${k}.mp4`)
        );
        if (matchedSampleKey) {
          transcript = SAMPLE_SCRIPTS[matchedSampleKey];
        } else {
          throw sttErr;
        }
      }

      await updateProjectRow(projectId, userId, {
        transcriptJson: JSON.stringify(transcript),
        status: 'analyzed',
      });
    }

    setProgress(projectId, 'analyzing_moments', 62, 'Detecting viral hooks and optimal clip boundaries...');
    const moments = await detectEngagingMoments({
      title: project.title,
      durationSec,
      transcript,
      config,
    });

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
        durationSec: Number((m.endSec - m.startSec).toFixed(2)),
        aspectRatio: config.aspectRatio,
        captionStyle: config.captionStyle,
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
    for (let i = 0; i < insertedClips.length; i++) {
      const clip = insertedClips[i];
      const pct = Math.round(70 + ((i + 0.5) / total) * 26);
      setProgress(
        projectId,
        'rendering_clips',
        pct,
        `Rendering clip ${i + 1} of ${total} (${config.aspectRatio} · ${config.captionStyle} captions)...`
      );

      try {
        const captions = JSON.parse(clip.captionsJson || '[]');
        const rendered = await renderClipMp4({
          clipId: clip.id,
          sourceFilePath: project.sourceFilePath,
          startSec: clip.startSec,
          endSec: clip.endSec,
          aspectRatio: config.aspectRatio,
          resolution: config.resolution,
          captionStyle: config.captionStyle,
          fontFamily: clip.fontFamily,
          highlightColor: clip.highlightColor,
          cropX: clip.cropX,
          enhanceAudio: clip.enhanceAudio,
          trimSilence: clip.trimSilence,
          bgMusic: clip.bgMusic,
          includeIntroOutro: clip.includeIntroOutro,
          captions,
        });

        await updateClipRow(clip.id, userId, {
          renderPath: rendered.renderPath,
          renderStatus: 'ready',
          fileSizeBytes: rendered.fileSizeBytes,
          durationSec: rendered.durationSec,
        });
      } catch (renderErr) {
        console.error(`Failed rendering clip ${clip.id}:`, renderErr);
        await updateClipRow(clip.id, userId, { renderStatus: 'error' });
      }
    }

    await deductUserCredits(userId, insertedClips.length * 2);
    await updateProjectRow(projectId, userId, { status: 'completed', errorMessage: '' });
    setProgress(projectId, 'completed', 100, `Generated ${insertedClips.length} ready-to-export clips.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected video processing error.';
    await updateProjectRow(projectId, userId, {
      status: 'error',
      errorMessage: message,
    }).catch(() => {});
    setProgress(projectId, 'error', 0, message);
  }
}
