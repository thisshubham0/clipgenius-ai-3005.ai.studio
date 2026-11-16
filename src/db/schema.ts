import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').default('Creator').notNull(),
  photoUrl: text('photo_url').default('').notNull(),
  credits: integer('credits').default(120).notNull(),
  plan: text('plan').default('Studio Pro').notNull(),
  preferencesJson: text('preferences_json').default('{}').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const projects = pgTable('projects', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  sourceType: text('source_type').notNull(), // 'youtube' | 'upload' | 'sample' | 'url'
  sourceUrl: text('source_url').default('').notNull(),
  youtubeId: text('youtube_id').default('').notNull(),
  channelName: text('channel_name').default('').notNull(),
  thumbnailUrl: text('thumbnail_url').default('').notNull(),
  durationSec: real('duration_sec').default(0).notNull(),
  sourceFilePath: text('source_file_path').default('').notNull(),
  status: text('status').default('draft').notNull(), // 'draft' | 'analyzing' | 'analyzed' | 'generating' | 'completed' | 'error'
  errorMessage: text('error_message').default('').notNull(),
  transcriptJson: text('transcript_json').default('[]').notNull(),
  configJson: text('config_json').default('{}').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const clips = pgTable('clips', {
  id: serial('id').primaryKey(),
  projectId: integer('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(),
  hook: text('hook').notNull(),
  description: text('description').default('').notNull(),
  hashtags: text('hashtags').default('').notNull(),
  startSec: real('start_sec').notNull(),
  endSec: real('end_sec').notNull(),
  durationSec: real('duration_sec').notNull(),
  aspectRatio: text('aspect_ratio').default('9:16').notNull(),
  captionStyle: text('caption_style').default('Modern').notNull(),
  fontFamily: text('font_family').default('Plus Jakarta Sans').notNull(),
  highlightColor: text('highlight_color').default('#38BDF8').notNull(),
  cropX: real('crop_x').default(0.5).notNull(),
  enhanceAudio: boolean('enhance_audio').default(true).notNull(),
  trimSilence: boolean('trim_silence').default(false).notNull(),
  bgMusic: boolean('bg_music').default(false).notNull(),
  includeIntroOutro: boolean('include_intro_outro').default(false).notNull(),
  viralScore: integer('viral_score').default(80).notNull(),
  scoreBreakdownJson: text('score_breakdown_json').default('{}').notNull(),
  captionsJson: text('captions_json').default('[]').notNull(),
  renderPath: text('render_path').default('').notNull(),
  renderStatus: text('render_status').default('pending').notNull(), // 'pending' | 'rendering' | 'ready' | 'error'
  renderResolution: text('render_resolution').default('1080p').notNull(),
  fileSizeBytes: integer('file_size_bytes').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const downloads = pgTable('downloads', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  clipId: integer('clip_id')
    .references(() => clips.id, { onDelete: 'cascade' })
    .notNull(),
  projectId: integer('project_id')
    .references(() => projects.id, { onDelete: 'cascade' })
    .notNull(),
  clipTitle: text('clip_title').notNull(),
  format: text('format').default('MP4').notNull(),
  resolution: text('resolution').default('1080p').notNull(),
  aspectRatio: text('aspect_ratio').default('9:16').notNull(),
  fileSizeBytes: integer('file_size_bytes').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  projects: many(projects),
  clips: many(clips),
  downloads: many(downloads),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  user: one(users, {
    fields: [projects.userId],
    references: [users.id],
  }),
  clips: many(clips),
  downloads: many(downloads),
}));

export const clipsRelations = relations(clips, ({ one, many }) => ({
  project: one(projects, {
    fields: [clips.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [clips.userId],
    references: [users.id],
  }),
  downloads: many(downloads),
}));

export const downloadsRelations = relations(downloads, ({ one }) => ({
  user: one(users, {
    fields: [downloads.userId],
    references: [users.id],
  }),
  clip: one(clips, {
    fields: [downloads.clipId],
    references: [clips.id],
  }),
  project: one(projects, {
    fields: [downloads.projectId],
    references: [projects.id],
  }),
}));
