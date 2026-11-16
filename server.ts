import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import {
  createProject,
  deleteProjectForUser,
  getClipByIdForUser,
  getDashboardSummaryForUser,
  getProjectByIdForUser,
  getProjectWithClipsForUser,
  listDownloadsForUser,
  listProjectsForUser,
  mapClipRow,
  mapProjectRow,
  recordDownloadRow,
  updateClipRow,
  updateProjectRow,
} from './src/db/queries.ts';
import { updateUserPreferences } from './src/db/users.ts';
import { AuthRequest, requireAuth, signDemoToken } from './src/middleware/auth.ts';
import { regenerateClipCopy } from './src/server/geminiService.ts';
import { enqueueProjectPipeline, getJobProgress } from './src/server/jobQueue.ts';
import {
  ensureSampleVideoExists,
  ensureStorageDirectories,
  getUploadsDir,
  probeVideoMetadata,
  renderClipMp4,
  STUDIO_SAMPLES,
} from './src/server/mediaPipeline.ts';
import type {
  AspectRatio,
  CaptionLine,
  CaptionStyle,
  ExportResolution,
  ProjectConfig,
  TranscriptSegment,
} from './src/shared/types.ts';
import { parseYouTubeUrl } from './src/utils/youtube.ts';

const PORT = Number(process.env.PORT_OVERRIDE || 3000);
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
const MAX_DURATION_SEC = 3600;

// Simple sliding-window rate limiter for AI/render endpoints
const rateBuckets = new Map<string, number[]>();
function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const timestamps = (rateBuckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    rateBuckets.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  rateBuckets.set(key, timestamps);
  return true;
}

const uploadStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    void ensureStorageDirectories().then(() => cb(null, getUploadsDir())).catch((err) => cb(err, ''));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    const safeExt = ['.mp4', '.mov', '.webm', '.m4v'].includes(ext) ? ext : '.mp4';
    cb(null, `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExt}`);
  },
});

const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_req, file, cb) => {
    const allowedMime =
      file.mimetype.startsWith('video/') ||
      /\.(mp4|mov|webm|m4v)$/i.test(file.originalname);
    if (!allowedMime) {
      return cb(new Error('Unsupported file format. Please upload MP4, MOV, or WebM video files.'));
    }
    cb(null, true);
  },
});

async function startServer() {
  await ensureStorageDirectories();

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'clipgenius-ai' });
  });

  app.post('/api/auth/demo-session', (_req, res) => {
    const token = signDemoToken();
    res.json({ token });
  });

  app.get('/api/samples', (_req, res) => {
    res.json({ samples: STUDIO_SAMPLES });
  });

  app.get('/api/me', requireAuth, async (req: AuthRequest, res) => {
    const u = req.authUser!;
    let preferences = {};
    try {
      preferences = JSON.parse(u.preferencesJson || '{}');
    } catch {
      preferences = {};
    }
    res.json({
      id: u.id,
      uid: u.uid,
      email: u.email,
      displayName: u.displayName,
      photoUrl: u.photoUrl,
      credits: u.credits,
      plan: u.plan,
      isDemo: u.isDemo,
      preferences,
    });
  });

  app.patch('/api/me/preferences', requireAuth, async (req: AuthRequest, res) => {
    try {
      const u = req.authUser!;
      const displayName = String(req.body?.displayName ?? u.displayName).trim().slice(0, 80);
      const preferences = req.body?.preferences ?? {};
      const updated = await updateUserPreferences(
        u.id,
        displayName || u.displayName,
        JSON.stringify(preferences)
      );
      res.json({
        displayName: updated.displayName,
        preferences,
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save preferences.' });
    }
  });

  app.get('/api/dashboard', requireAuth, async (req: AuthRequest, res) => {
    try {
      const u = req.authUser!;
      const summary = await getDashboardSummaryForUser(u.id, u.credits, u.plan);
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load dashboard.' });
    }
  });

  app.post('/api/youtube/inspect', requireAuth, async (req: AuthRequest, res) => {
    const u = req.authUser!;
    if (!checkRateLimit(`yt:${u.id}`, 30, 60_000)) {
      return res.status(429).json({ error: 'Too many URL lookups. Please wait a minute.' });
    }

    const rawUrl = String(req.body?.url ?? '');
    const parsed = parseYouTubeUrl(rawUrl);
    if (!parsed.valid) {
      return res.status(400).json({ error: parsed.error || 'Invalid YouTube URL.' });
    }

    let title = `YouTube Video (${parsed.videoId})`;
    let channelName = 'YouTube Creator';
    let thumbnailUrl = `https://i.ytimg.com/vi/${parsed.videoId}/hqdefault.jpg`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.canonicalUrl)}&format=json`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);
      if (oembedRes.ok) {
        const data = (await oembedRes.json()) as {
          title?: string;
          author_name?: string;
          thumbnail_url?: string;
        };
        if (data.title) title = data.title;
        if (data.author_name) channelName = data.author_name;
        if (data.thumbnail_url) thumbnailUrl = data.thumbnail_url;
      }
    } catch {
      // Fallback metadata still valid from videoId if external oEmbed is unreachable
    }

    res.json({
      valid: true,
      videoId: parsed.videoId,
      canonicalUrl: parsed.canonicalUrl,
      urlType: parsed.urlType,
      title,
      channelName,
      thumbnailUrl,
      directStreamPermitted: false,
      permissionReason:
        'Direct YouTube stream extraction is restricted by platform terms and DRM protections. Attach your authorized video file (MP4/MOV/WebM) or launch a Studio Sample Video to run real audio transcription, AI clipping, and MP4 rendering.',
    });
  });

  app.post('/api/upload', requireAuth, (req: AuthRequest, res) => {
    upload.single('video')(req, res, async (err) => {
      if (err) {
        const message =
          err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE'
            ? 'Video file exceeds the 250 MB limit.'
            : err.message || 'Video upload failed.';
        return res.status(400).json({ error: message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'Please select a video file to upload.' });
      }

      try {
        const u = req.authUser!;
        const probe = await probeVideoMetadata(req.file.path);
        if (probe.durationSec > MAX_DURATION_SEC) {
          await fsp.unlink(req.file.path).catch(() => {});
          return res.status(400).json({
            error: 'Video exceeds the 60-minute duration limit for this workspace.',
          });
        }

        const customTitle = String(req.body?.title ?? '').trim();
        const projectTitle =
          customTitle ||
          path.basename(req.file.originalname, path.extname(req.file.originalname)) ||
          'Uploaded Video Project';

        const project = await createProject({
          userId: u.id,
          title: projectTitle,
          sourceType: 'upload',
          sourceUrl: req.file.originalname,
          channelName: u.displayName,
          thumbnailUrl: '/src/assets/images/hero_studio_preview_1794825184394.jpg',
          durationSec: probe.durationSec,
          sourceFilePath: req.file.path,
          status: 'draft',
        });

        res.status(201).json({ project: mapProjectRow(project, 0) });
      } catch (probeErr) {
        await fsp.unlink(req.file.path).catch(() => {});
        res.status(400).json({
          error:
            probeErr instanceof Error
              ? `Could not read video stream: ${probeErr.message}`
              : 'Invalid video file.',
        });
      }
    });
  });

  app.post('/api/projects', requireAuth, async (req: AuthRequest, res) => {
    try {
      const u = req.authUser!;
      const sourceType = String(req.body?.sourceType ?? 'youtube') as
        | 'youtube'
        | 'sample'
        | 'url';

      if (sourceType === 'sample') {
        const sampleId = String(req.body?.sampleId ?? STUDIO_SAMPLES[0].id);
        const sample = STUDIO_SAMPLES.find((s) => s.id === sampleId) ?? STUDIO_SAMPLES[0];
        const samplePath = await ensureSampleVideoExists(sample.id);
        const probe = await probeVideoMetadata(samplePath);

        const project = await createProject({
          userId: u.id,
          title: String(req.body?.title ?? sample.title),
          sourceType: 'sample',
          sourceUrl: sample.youtubeReferenceUrl,
          channelName: sample.channelName,
          thumbnailUrl: sample.thumbnailUrl,
          durationSec: probe.durationSec,
          sourceFilePath: samplePath,
          status: 'draft',
          config: {
            contentStyle: sample.contentStyle,
            ...(req.body?.config ?? {}),
          },
        });
        return res.status(201).json({ project: mapProjectRow(project, 0) });
      }

      if (sourceType === 'url') {
        const directUrl = String(req.body?.sourceUrl ?? '').trim();
        if (!/^https?:\/\//i.test(directUrl)) {
          return res.status(400).json({ error: 'Enter a valid HTTP/HTTPS MP4 video URL.' });
        }
        const dlRes = await fetch(directUrl);
        if (!dlRes.ok) {
          return res.status(400).json({ error: `Unable to fetch media URL (HTTP ${dlRes.status}).` });
        }
        const contentType = dlRes.headers.get('content-type') || '';
        if (!contentType.includes('video/') && !directUrl.toLowerCase().includes('.mp4')) {
          return res.status(400).json({
            error: 'URL did not return a direct video stream. Please provide a direct MP4 URL or upload a file.',
          });
        }
        const buf = Buffer.from(await dlRes.arrayBuffer());
        if (buf.length > MAX_UPLOAD_BYTES) {
          return res.status(400).json({ error: 'Remote video exceeds the 250 MB limit.' });
        }
        const filePath = path.join(getUploadsDir(), `remote-${Date.now()}.mp4`);
        await fsp.writeFile(filePath, buf);
        const probe = await probeVideoMetadata(filePath);
        const project = await createProject({
          userId: u.id,
          title: String(req.body?.title ?? 'Imported MP4 Video'),
          sourceType: 'url',
          sourceUrl: directUrl,
          channelName: 'Authorized Remote Media',
          thumbnailUrl: '/src/assets/images/hero_studio_preview_1794825184394.jpg',
          durationSec: probe.durationSec,
          sourceFilePath: filePath,
          status: 'draft',
          config: req.body?.config,
        });
        return res.status(201).json({ project: mapProjectRow(project, 0) });
      }

      // YouTube metadata project (requires attaching authorized file or studio sample before rendering)
      const youtubeUrl = String(req.body?.sourceUrl ?? '');
      const parsed = parseYouTubeUrl(youtubeUrl);
      if (!parsed.valid) {
        return res.status(400).json({ error: parsed.error || 'Invalid YouTube URL.' });
      }

      const project = await createProject({
        userId: u.id,
        title: String(req.body?.title || `YouTube Project (${parsed.videoId})`),
        sourceType: 'youtube',
        sourceUrl: parsed.canonicalUrl,
        youtubeId: parsed.videoId,
        channelName: String(req.body?.channelName || 'YouTube Creator'),
        thumbnailUrl:
          String(req.body?.thumbnailUrl || '') ||
          `https://i.ytimg.com/vi/${parsed.videoId}/hqdefault.jpg`,
        durationSec: 0,
        sourceFilePath: '',
        status: 'draft',
        config: req.body?.config,
      });

      res.status(201).json({ project: mapProjectRow(project, 0) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create project.' });
    }
  });

  app.post('/api/projects/:id/attach-source', requireAuth, (req: AuthRequest, res) => {
    upload.single('video')(req, res, async (err) => {
      const u = req.authUser!;
      const projectId = Number(req.params.id);
      const existing = await getProjectByIdForUser(projectId, u.id);
      if (!existing) {
        return res.status(404).json({ error: 'Project not found.' });
      }

      if (err) {
        return res.status(400).json({ error: err.message || 'Upload failed.' });
      }

      try {
        if (req.file) {
          const probe = await probeVideoMetadata(req.file.path);
          const updated = await updateProjectRow(projectId, u.id, {
            sourceFilePath: req.file.path,
            durationSec: probe.durationSec,
            status: 'draft',
            errorMessage: '',
            transcriptJson: '[]',
          });
          return res.json({ project: mapProjectRow(updated!, 0) });
        }

        const sampleId = String(req.body?.sampleId ?? '');
        if (sampleId) {
          const sample = STUDIO_SAMPLES.find((s) => s.id === sampleId) ?? STUDIO_SAMPLES[0];
          const samplePath = await ensureSampleVideoExists(sample.id);
          const probe = await probeVideoMetadata(samplePath);
          const updated = await updateProjectRow(projectId, u.id, {
            sourceFilePath: samplePath,
            durationSec: probe.durationSec,
            status: 'draft',
            errorMessage: '',
            transcriptJson: '[]',
          });
          return res.json({ project: mapProjectRow(updated!, 0) });
        }

        return res.status(400).json({ error: 'Provide a video file or studio sample ID.' });
      } catch (attachErr) {
        res.status(500).json({
          error: attachErr instanceof Error ? attachErr.message : 'Failed to attach video source.',
        });
      }
    });
  });

  app.get('/api/projects', requireAuth, async (req: AuthRequest, res) => {
    try {
      const projects = await listProjectsForUser(req.authUser!.id);
      res.json({ projects });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list projects.' });
    }
  });

  app.get('/api/projects/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const projectId = Number(req.params.id);
      const project = await getProjectWithClipsForUser(projectId, req.authUser!.id);
      if (!project) {
        return res.status(404).json({ error: 'Project not found.' });
      }
      const progress = getJobProgress(projectId);
      res.json({ project, progress });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to fetch project.' });
    }
  });

  app.delete('/api/projects/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const projectId = Number(req.params.id);
      const deleted = await deleteProjectForUser(projectId, req.authUser!.id);
      if (!deleted) {
        return res.status(404).json({ error: 'Project not found.' });
      }
      res.json({ deleted: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to delete project.' });
    }
  });

  app.post('/api/projects/:id/analyze', requireAuth, async (req: AuthRequest, res) => {
    const u = req.authUser!;
    if (!checkRateLimit(`analyze:${u.id}`, 12, 60_000)) {
      return res.status(429).json({ error: 'Processing rate limit reached. Please wait a moment.' });
    }

    try {
      const projectId = Number(req.params.id);
      const project = await getProjectByIdForUser(projectId, u.id);
      if (!project) {
        return res.status(404).json({ error: 'Project not found.' });
      }
      if (!project.sourceFilePath) {
        return res.status(400).json({
          error:
            'No authorized video file attached. Upload your video file or select an Authorized Studio Sample before analyzing.',
        });
      }

      const incoming = (req.body?.config ?? {}) as Partial<ProjectConfig>;
      let existingConfig: ProjectConfig;
      try {
        existingConfig = JSON.parse(project.configJson || '{}');
      } catch {
        existingConfig = {
          clipCount: 3,
          clipDuration: 30,
          aspectRatio: '9:16',
          captionStyle: 'Modern',
          contentStyle: 'Podcast',
          enhanceAudio: true,
          trimSilence: false,
          bgMusic: false,
          includeIntroOutro: false,
          resolution: '1080p',
        };
      }

      const mergedConfig: ProjectConfig = {
        clipCount: Math.max(1, Math.min(10, Number(incoming.clipCount ?? existingConfig.clipCount ?? 3))),
        clipDuration: Math.max(10, Math.min(90, Number(incoming.clipDuration ?? existingConfig.clipDuration ?? 30))),
        aspectRatio: (incoming.aspectRatio ?? existingConfig.aspectRatio ?? '9:16') as AspectRatio,
        captionStyle: (incoming.captionStyle ?? existingConfig.captionStyle ?? 'Modern') as CaptionStyle,
        contentStyle: (incoming.contentStyle ?? existingConfig.contentStyle ?? 'Podcast') as ProjectConfig['contentStyle'],
        enhanceAudio: Boolean(incoming.enhanceAudio ?? existingConfig.enhanceAudio ?? true),
        trimSilence: Boolean(incoming.trimSilence ?? existingConfig.trimSilence ?? false),
        bgMusic: Boolean(incoming.bgMusic ?? existingConfig.bgMusic ?? false),
        includeIntroOutro: Boolean(incoming.includeIntroOutro ?? existingConfig.includeIntroOutro ?? false),
        resolution: (incoming.resolution ?? existingConfig.resolution ?? '1080p') as ExportResolution,
      };

      enqueueProjectPipeline({
        projectId,
        userId: u.id,
        config: mergedConfig,
      });

      res.json({ started: true, progress: getJobProgress(projectId) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to start analysis.' });
    }
  });

  app.post('/api/clips/:id/regenerate', requireAuth, async (req: AuthRequest, res) => {
    try {
      const u = req.authUser!;
      const clipId = Number(req.params.id);
      const clip = await getClipByIdForUser(clipId, u.id);
      if (!clip) {
        return res.status(404).json({ error: 'Clip not found.' });
      }
      const project = await getProjectByIdForUser(clip.projectId, u.id);
      if (!project) {
        return res.status(404).json({ error: 'Parent project not found.' });
      }

      let captions: CaptionLine[] = [];
      try {
        captions = JSON.parse(clip.captionsJson || '[]') as CaptionLine[];
      } catch {
        captions = [];
      }
      const snippet = captions.map((c) => c.text).join(' ') || clip.hook;
      const cfg = JSON.parse(project.configJson || '{}') as Partial<ProjectConfig>;

      const freshCopy = await regenerateClipCopy({
        projectTitle: project.title,
        transcriptSnippet: snippet,
        currentTitle: clip.title,
        contentStyle: cfg.contentStyle || 'Podcast',
      });

      const updated = await updateClipRow(clipId, u.id, {
        title: freshCopy.title,
        hook: freshCopy.hook,
        description: freshCopy.description,
        hashtags: freshCopy.hashtags,
      });

      res.json({ clip: mapClipRow(updated!) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to regenerate clip copy.' });
    }
  });

  app.patch('/api/clips/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const u = req.authUser!;
      const clipId = Number(req.params.id);
      const clip = await getClipByIdForUser(clipId, u.id);
      if (!clip) {
        return res.status(404).json({ error: 'Clip not found.' });
      }
      const project = await getProjectByIdForUser(clip.projectId, u.id);
      if (!project || !project.sourceFilePath) {
        return res.status(400).json({ error: 'Source video file is unavailable for re-rendering.' });
      }

      const startSec = Math.max(0, Number(req.body?.startSec ?? clip.startSec));
      const maxEnd = project.durationSec > 0 ? project.durationSec : clip.endSec;
      const endSec = Math.min(maxEnd, Math.max(startSec + 2, Number(req.body?.endSec ?? clip.endSec)));
      const aspectRatio = (req.body?.aspectRatio ?? clip.aspectRatio) as AspectRatio;
      const captionStyle = (req.body?.captionStyle ?? clip.captionStyle) as CaptionStyle;
      const fontFamily = String(req.body?.fontFamily ?? clip.fontFamily);
      const highlightColor = String(req.body?.highlightColor ?? clip.highlightColor);
      const cropX = Math.max(0, Math.min(1, Number(req.body?.cropX ?? clip.cropX)));
      const enhanceAudio = Boolean(req.body?.enhanceAudio ?? clip.enhanceAudio);
      const trimSilence = Boolean(req.body?.trimSilence ?? clip.trimSilence);
      const bgMusic = Boolean(req.body?.bgMusic ?? clip.bgMusic);
      const includeIntroOutro = Boolean(req.body?.includeIntroOutro ?? clip.includeIntroOutro);
      const renderResolution = (req.body?.renderResolution ?? clip.renderResolution) as ExportResolution;
      const title = String(req.body?.title ?? clip.title).trim() || clip.title;
      const hook = String(req.body?.hook ?? clip.hook).trim() || clip.hook;
      const description = String(req.body?.description ?? clip.description);
      const hashtags = String(req.body?.hashtags ?? clip.hashtags);
      const captions: CaptionLine[] = Array.isArray(req.body?.captions)
        ? req.body.captions
        : (JSON.parse(clip.captionsJson || '[]') as CaptionLine[]);

      await updateClipRow(clipId, u.id, { renderStatus: 'rendering' });

      const rendered = await renderClipMp4({
        clipId,
        sourceFilePath: project.sourceFilePath,
        startSec,
        endSec,
        aspectRatio,
        resolution: renderResolution,
        captionStyle,
        fontFamily,
        highlightColor,
        cropX,
        enhanceAudio,
        trimSilence,
        bgMusic,
        includeIntroOutro,
        captions,
      });

      const updated = await updateClipRow(clipId, u.id, {
        title,
        hook,
        description,
        hashtags,
        startSec,
        endSec,
        durationSec: rendered.durationSec,
        aspectRatio,
        captionStyle,
        fontFamily,
        highlightColor,
        cropX,
        enhanceAudio,
        trimSilence,
        bgMusic,
        includeIntroOutro,
        captionsJson: JSON.stringify(captions),
        renderPath: rendered.renderPath,
        renderStatus: 'ready',
        renderResolution,
        fileSizeBytes: rendered.fileSizeBytes,
      });

      res.json({ clip: mapClipRow(updated!) });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to render updated clip.' });
    }
  });

  app.get('/api/clips/:id/video', requireAuth, async (req: AuthRequest, res) => {
    try {
      const u = req.authUser!;
      const clipId = Number(req.params.id);
      const clip = await getClipByIdForUser(clipId, u.id);
      if (!clip || !clip.renderPath) {
        return res.status(404).json({ error: 'Rendered clip video not found.' });
      }

      const stat = await fsp.stat(clip.renderPath).catch(() => null);
      if (!stat) {
        return res.status(404).json({ error: 'Rendered file is missing on disk.' });
      }

      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunksize = end - start + 1;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': 'video/mp4',
        });
        fs.createReadStream(clip.renderPath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(clip.renderPath).pipe(res);
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Streaming failed.' });
    }
  });

  app.get('/api/clips/:id/download', requireAuth, async (req: AuthRequest, res) => {
    try {
      const u = req.authUser!;
      const clipId = Number(req.params.id);
      const clip = await getClipByIdForUser(clipId, u.id);
      if (!clip || !clip.renderPath) {
        return res.status(404).json({ error: 'Rendered clip file not ready for download.' });
      }

      const requestedRes =
        req.query.resolution === '720p' || req.query.resolution === '1080p'
          ? (req.query.resolution as ExportResolution)
          : (clip.renderResolution as ExportResolution);

      let downloadPath = clip.renderPath;
      let fileSize = clip.fileSizeBytes;

      if (requestedRes !== clip.renderResolution) {
        const project = await getProjectByIdForUser(clip.projectId, u.id);
        if (project?.sourceFilePath) {
          const captions = JSON.parse(clip.captionsJson || '[]') as CaptionLine[];
          const reRendered = await renderClipMp4({
            clipId: clip.id,
            sourceFilePath: project.sourceFilePath,
            startSec: clip.startSec,
            endSec: clip.endSec,
            aspectRatio: clip.aspectRatio as AspectRatio,
            resolution: requestedRes,
            captionStyle: clip.captionStyle as CaptionStyle,
            fontFamily: clip.fontFamily,
            highlightColor: clip.highlightColor,
            cropX: clip.cropX,
            enhanceAudio: clip.enhanceAudio,
            trimSilence: clip.trimSilence,
            bgMusic: clip.bgMusic,
            includeIntroOutro: clip.includeIntroOutro,
            captions,
          });
          downloadPath = reRendered.renderPath;
          fileSize = reRendered.fileSizeBytes;
        }
      }

      await recordDownloadRow({
        userId: u.id,
        clipId: clip.id,
        projectId: clip.projectId,
        clipTitle: clip.title,
        format: 'MP4',
        resolution: requestedRes,
        aspectRatio: clip.aspectRatio,
        fileSizeBytes: fileSize,
      });

      const safeSlug = clip.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48);

      res.download(downloadPath, `${safeSlug || `clip-${clip.id}`}-${requestedRes}.mp4`);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Download failed.' });
    }
  });

  app.get('/api/downloads', requireAuth, async (req: AuthRequest, res) => {
    try {
      const items = await listDownloadsForUser(req.authUser!.id);
      res.json({ downloads: items });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load downloads.' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(process.cwd(), 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(process.cwd(), 'dist/index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ClipGenius AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
