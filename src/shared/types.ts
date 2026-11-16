export type AspectRatio = '9:16' | '1:1' | '16:9';
export type CaptionStyle = 'Minimal' | 'Animated' | 'Bold' | 'Karaoke' | 'Modern';
export type ContentStyle = 'Educational' | 'Podcast' | 'Motivational' | 'Entertainment' | 'Business';
export type ExportResolution = '720p' | '1080p';

export interface TranscriptSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface CaptionLine {
  id: string;
  start: number;
  end: number;
  text: string;
  highlightWords?: string[];
  speaker?: string;
}

export interface ScoreBreakdown {
  hookStrength: number;
  audienceRelevance: number;
  emotionalImpact: number;
  infoValue: number;
  storyCompleteness: number;
}

export interface ProjectConfig {
  clipCount: number;
  clipDuration: number; // target seconds: 15 | 30 | 45 | 60 | 90
  aspectRatio: AspectRatio;
  captionStyle: CaptionStyle;
  contentStyle: ContentStyle;
  enhanceAudio: boolean;
  trimSilence: boolean;
  bgMusic: boolean;
  includeIntroOutro: boolean;
  resolution: ExportResolution;
}

export interface ProjectDTO {
  id: number;
  title: string;
  sourceType: 'youtube' | 'upload' | 'sample' | 'url';
  sourceUrl: string;
  youtubeId: string;
  channelName: string;
  thumbnailUrl: string;
  durationSec: number;
  hasMediaSource: boolean;
  status: 'draft' | 'analyzing' | 'analyzed' | 'generating' | 'completed' | 'error';
  errorMessage: string;
  transcript: TranscriptSegment[];
  config: ProjectConfig;
  clipCount?: number;
  clips?: ClipDTO[];
  createdAt: string;
  updatedAt: string;
}

export interface ClipDTO {
  id: number;
  projectId: number;
  title: string;
  hook: string;
  description: string;
  hashtags: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  aspectRatio: AspectRatio;
  captionStyle: CaptionStyle;
  fontFamily: string;
  highlightColor: string;
  cropX: number;
  enhanceAudio: boolean;
  trimSilence: boolean;
  bgMusic: boolean;
  includeIntroOutro: boolean;
  viralScore: number;
  scoreBreakdown: ScoreBreakdown;
  captions: CaptionLine[];
  renderStatus: 'pending' | 'rendering' | 'ready' | 'error';
  renderResolution: ExportResolution;
  fileSizeBytes: number;
  videoUrl: string;
  createdAt: string;
}

export interface DownloadDTO {
  id: number;
  clipId: number;
  projectId: number;
  clipTitle: string;
  format: string;
  resolution: string;
  aspectRatio: string;
  fileSizeBytes: number;
  createdAt: string;
}

export interface JobProgress {
  projectId: number;
  stage:
    | 'queued'
    | 'acquiring_media'
    | 'extracting_audio'
    | 'transcribing'
    | 'analyzing_moments'
    | 'rendering_clips'
    | 'completed'
    | 'error';
  percent: number;
  message: string;
  updatedAt: number;
}

export interface StudioSample {
  id: string;
  title: string;
  channelName: string;
  description: string;
  durationSec: number;
  thumbnailUrl: string;
  contentStyle: ContentStyle;
  youtubeReferenceUrl: string;
}

export interface YouTubeInspectResult {
  valid: boolean;
  videoId: string;
  canonicalUrl: string;
  urlType: 'standard' | 'shortlink' | 'shorts' | 'live' | 'embed';
  title: string;
  channelName: string;
  thumbnailUrl: string;
  directStreamPermitted: boolean;
  permissionReason: string;
}

export interface DashboardSummary {
  totalVideos: number;
  totalClips: number;
  credits: number;
  plan: string;
  recentProjects: ProjectDTO[];
  recentDownloads: DownloadDTO[];
}
