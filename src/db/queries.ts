import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { db } from './index.ts';
import { clips, downloads, projects } from './schema.ts';
import type {
  AspectRatio,
  CaptionLine,
  CaptionStyle,
  ClipDTO,
  DashboardSummary,
  DownloadDTO,
  ExportResolution,
  ProjectConfig,
  ProjectDTO,
  ScoreBreakdown,
  TranscriptSegment,
  VideoTheme,
} from '../shared/types.ts';

const DEFAULT_CONFIG: ProjectConfig = {
  clipCount: 3,
  clipDuration: 30,
  aspectRatio: '9:16',
  captionStyle: 'Modern',
  videoTheme: 'Original',
  contentStyle: 'Podcast',
  enhanceAudio: true,
  trimSilence: false,
  bgMusic: false,
  includeIntroOutro: false,
  resolution: '1080p',
};

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function mapProjectRow(
  row: typeof projects.$inferSelect,
  clipCount?: number,
  clipRows?: Array<typeof clips.$inferSelect>
): ProjectDTO {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.sourceType as ProjectDTO['sourceType'],
    sourceUrl: row.sourceUrl,
    youtubeId: row.youtubeId,
    channelName: row.channelName,
    thumbnailUrl: row.thumbnailUrl,
    durationSec: row.durationSec,
    hasMediaSource: Boolean(row.sourceFilePath),
    status: row.status as ProjectDTO['status'],
    errorMessage: row.errorMessage,
    transcript: safeJsonParse<TranscriptSegment[]>(row.transcriptJson, []),
    config: { ...DEFAULT_CONFIG, ...safeJsonParse<Partial<ProjectConfig>>(row.configJson, {}) },
    clipCount,
    clips: clipRows ? clipRows.map(mapClipRow) : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapClipRow(row: typeof clips.$inferSelect): ClipDTO {
  const defaultBreakdown: ScoreBreakdown = {
    hookStrength: 82,
    audienceRelevance: 80,
    emotionalImpact: 78,
    infoValue: 84,
    storyCompleteness: 80,
  };
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    hook: row.hook,
    description: row.description,
    hashtags: row.hashtags,
    startSec: row.startSec,
    endSec: row.endSec,
    durationSec: row.durationSec,
    aspectRatio: row.aspectRatio as AspectRatio,
    captionStyle: row.captionStyle as CaptionStyle,
    videoTheme: (row.videoTheme || 'Original') as VideoTheme,
    fontFamily: row.fontFamily,
    highlightColor: row.highlightColor,
    cropX: row.cropX,
    enhanceAudio: row.enhanceAudio,
    trimSilence: row.trimSilence,
    bgMusic: row.bgMusic,
    includeIntroOutro: row.includeIntroOutro,
    viralScore: row.viralScore,
    scoreBreakdown: safeJsonParse<ScoreBreakdown>(row.scoreBreakdownJson, defaultBreakdown),
    captions: safeJsonParse<CaptionLine[]>(row.captionsJson, []),
    renderStatus: row.renderStatus as ClipDTO['renderStatus'],
    renderResolution: row.renderResolution as ExportResolution,
    fileSizeBytes: row.fileSizeBytes,
    videoUrl: `/api/clips/${row.id}/video`,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createProject(params: {
  userId: number;
  title: string;
  sourceType: 'youtube' | 'upload' | 'sample' | 'url';
  sourceUrl?: string;
  youtubeId?: string;
  channelName?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  sourceFilePath?: string;
  status?: string;
  config?: Partial<ProjectConfig>;
}) {
  try {
    const mergedConfig = { ...DEFAULT_CONFIG, ...(params.config ?? {}) };
    const rows = await db
      .insert(projects)
      .values({
        userId: params.userId,
        title: params.title,
        sourceType: params.sourceType,
        sourceUrl: params.sourceUrl ?? '',
        youtubeId: params.youtubeId ?? '',
        channelName: params.channelName ?? '',
        thumbnailUrl: params.thumbnailUrl ?? '',
        durationSec: params.durationSec ?? 0,
        sourceFilePath: params.sourceFilePath ?? '',
        status: params.status ?? 'draft',
        configJson: JSON.stringify(mergedConfig),
      })
      .returning();
    return rows[0];
  } catch (error) {
    console.error('Database error in createProject:', error);
    throw new Error('Failed to create project.', { cause: error });
  }
}

export async function getProjectByIdForUser(projectId: number, userId: number) {
  try {
    const rows = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database error in getProjectByIdForUser:', error);
    throw new Error('Failed to load project.', { cause: error });
  }
}

export async function getProjectWithClipsForUser(projectId: number, userId: number) {
  try {
    const project = await getProjectByIdForUser(projectId, userId);
    if (!project) return null;
    const clipRows = await db
      .select()
      .from(clips)
      .where(and(eq(clips.projectId, projectId), eq(clips.userId, userId)))
      .orderBy(desc(clips.viralScore), clips.id);
    return mapProjectRow(project, clipRows.length, clipRows);
  } catch (error) {
    console.error('Database error in getProjectWithClipsForUser:', error);
    throw new Error('Failed to load project clips.', { cause: error });
  }
}

export async function listProjectsForUser(userId: number): Promise<ProjectDTO[]> {
  try {
    const projectRows = await db
      .select()
      .from(projects)
      .where(eq(projects.userId, userId))
      .orderBy(desc(projects.updatedAt), desc(projects.id));

    const clipRows = await db
      .select({ projectId: clips.projectId })
      .from(clips)
      .where(eq(clips.userId, userId));

    const countsByProject = new Map<number, number>();
    for (const c of clipRows) {
      countsByProject.set(c.projectId, (countsByProject.get(c.projectId) ?? 0) + 1);
    }

    return projectRows.map((p) => mapProjectRow(p, countsByProject.get(p.id) ?? 0));
  } catch (error) {
    console.error('Database error in listProjectsForUser:', error);
    throw new Error('Failed to list projects.', { cause: error });
  }
}

export async function updateProjectRow(
  projectId: number,
  userId: number,
  updates: Partial<{
    title: string;
    sourceType: string;
    sourceUrl: string;
    channelName: string;
    thumbnailUrl: string;
    durationSec: number;
    sourceFilePath: string;
    status: string;
    errorMessage: string;
    transcriptJson: string;
    configJson: string;
  }>
) {
  try {
    const rows = await db
      .update(projects)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .returning();
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database error in updateProjectRow:', error);
    throw new Error('Failed to update project.', { cause: error });
  }
}

export async function deleteProjectForUser(projectId: number, userId: number) {
  try {
    const deleted = await db
      .delete(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .returning();
    return deleted[0] ?? null;
  } catch (error) {
    console.error('Database error in deleteProjectForUser:', error);
    throw new Error('Failed to delete project.', { cause: error });
  }
}

export async function replaceClipsForProject(
  projectId: number,
  userId: number,
  newClips: Array<typeof clips.$inferInsert>
) {
  try {
    await db
      .delete(clips)
      .where(and(eq(clips.projectId, projectId), eq(clips.userId, userId)));
    if (newClips.length === 0) return [];
    return await db.insert(clips).values(newClips).returning();
  } catch (error) {
    console.error('Database error in replaceClipsForProject:', error);
    throw new Error('Failed to save generated clips.', { cause: error });
  }
}

export async function getClipByIdForUser(clipId: number, userId: number) {
  try {
    const rows = await db
      .select()
      .from(clips)
      .where(and(eq(clips.id, clipId), eq(clips.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database error in getClipByIdForUser:', error);
    throw new Error('Failed to load clip.', { cause: error });
  }
}

export async function updateClipRow(
  clipId: number,
  userId: number,
  updates: Partial<typeof clips.$inferInsert>
) {
  try {
    const rows = await db
      .update(clips)
      .set(updates)
      .where(and(eq(clips.id, clipId), eq(clips.userId, userId)))
      .returning();
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database error in updateClipRow:', error);
    throw new Error('Failed to update clip.', { cause: error });
  }
}

export async function recordDownloadRow(params: {
  userId: number;
  clipId: number;
  projectId: number;
  clipTitle: string;
  format: string;
  resolution: string;
  aspectRatio: string;
  fileSizeBytes: number;
}) {
  try {
    const rows = await db.insert(downloads).values(params).returning();
    return rows[0];
  } catch (error) {
    console.error('Database error in recordDownloadRow:', error);
    throw new Error('Failed to record download history.', { cause: error });
  }
}

export async function listDownloadsForUser(userId: number): Promise<DownloadDTO[]> {
  try {
    const rows = await db
      .select()
      .from(downloads)
      .where(eq(downloads.userId, userId))
      .orderBy(desc(downloads.createdAt), desc(downloads.id))
      .limit(50);

    return rows.map((d) => ({
      id: d.id,
      clipId: d.clipId,
      projectId: d.projectId,
      clipTitle: d.clipTitle,
      format: d.format,
      resolution: d.resolution,
      aspectRatio: d.aspectRatio,
      fileSizeBytes: d.fileSizeBytes,
      createdAt: d.createdAt.toISOString(),
    }));
  } catch (error) {
    console.error('Database error in listDownloadsForUser:', error);
    throw new Error('Failed to load download history.', { cause: error });
  }
}

export async function getDashboardSummaryForUser(
  userId: number,
  credits: number,
  plan: string
): Promise<DashboardSummary> {
  try {
    const [projCountRow] = await db
      .select({ value: count() })
      .from(projects)
      .where(eq(projects.userId, userId));

    const [clipCountRow] = await db
      .select({ value: count() })
      .from(clips)
      .where(eq(clips.userId, userId));

    const recentProjects = (await listProjectsForUser(userId)).slice(0, 5);
    const recentDownloads = (await listDownloadsForUser(userId)).slice(0, 5);

    return {
      totalVideos: Number(projCountRow?.value ?? 0),
      totalClips: Number(clipCountRow?.value ?? 0),
      credits,
      plan,
      recentProjects,
      recentDownloads,
    };
  } catch (error) {
    console.error('Database error in getDashboardSummaryForUser:', error);
    throw new Error('Failed to load dashboard metrics.', { cause: error });
  }
}

export async function recoverInterruptedProjects(): Promise<number> {
  try {
    const recovered = await db
      .update(projects)
      .set({
        status: 'error',
        errorMessage: 'Processing was interrupted by a server restart. Click Retry to resume.',
        updatedAt: new Date(),
      })
      .where(inArray(projects.status, ['analyzing', 'analyzed', 'generating']))
      .returning({ id: projects.id });
    return recovered.length;
  } catch (error) {
    console.error('Database error in recoverInterruptedProjects:', error);
    return 0;
  }
}
