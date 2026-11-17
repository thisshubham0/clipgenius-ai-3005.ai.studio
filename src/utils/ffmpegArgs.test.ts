import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAssSubtitles,
  buildVideoFilterGraph,
  clampClipWindow,
  computeAudioChunkWindows,
  formatAssTime,
  getTargetDimensions,
  hexToAssBgr,
  resolveSystemFontName,
} from './ffmpegArgs';
import {
  CAPTION_STYLES,
  getCaptionStyleMeta,
  getVideoThemeMeta,
  normalizeCaptionStyle,
  normalizeVideoTheme,
} from './videoStyles';

test('getTargetDimensions returns exact vertical, square, and landscape sizes', () => {
  assert.deepEqual(getTargetDimensions('9:16', '1080p'), { width: 1080, height: 1920 });
  assert.deepEqual(getTargetDimensions('9:16', '720p'), { width: 720, height: 1280 });
  assert.deepEqual(getTargetDimensions('1:1', '1080p'), { width: 1080, height: 1080 });
  assert.deepEqual(getTargetDimensions('16:9', '720p'), { width: 1280, height: 720 });
});

test('formatAssTime and hexToAssBgr format ASS subtitle syntax properly', () => {
  assert.equal(formatAssTime(65.5), '0:01:05.50');
  assert.equal(hexToAssBgr('#38BDF8'), '&H00F8BD38');
});

test('resolveSystemFontName maps UI fonts to installed system fonts', () => {
  assert.equal(resolveSystemFontName('Plus Jakarta Sans'), 'Noto Sans');
  assert.equal(resolveSystemFontName('DM Sans'), 'Liberation Sans');
  assert.equal(resolveSystemFontName('JetBrains Mono'), 'JetBrains Mono');
  assert.equal(resolveSystemFontName('Arial'), 'Liberation Sans');
});

test('buildAssSubtitles generates valid ASS dialogue events with karaoke & highlights', () => {
  const ass = buildAssSubtitles({
    captions: [
      { id: 'c1', start: 0, end: 2.5, text: 'Build faster with AI clipping', highlightWords: ['faster'] },
    ],
    aspectRatio: '9:16',
    resolution: '1080p',
    captionStyle: 'Karaoke',
    fontFamily: 'Plus Jakarta Sans',
    highlightColor: '#38BDF8',
  });
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /Noto Sans/);
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:02\.50/);
  assert.match(ass, /\\kf/);
});

test('buildAssSubtitles supports Neon Glow, Comic Pop, and Typewriter fancy captions', () => {
  const neon = buildAssSubtitles({
    captions: [{ id: 'f1', start: 0, end: 2, text: 'Watch this moment', highlightWords: ['moment'] }],
    aspectRatio: '9:16',
    resolution: '1080p',
    captionStyle: 'Neon Glow',
    fontFamily: 'Plus Jakarta Sans',
    highlightColor: '#22D3EE',
  });
  assert.match(neon, /\\blur2\.5/);
  assert.match(neon, /&H00EED322/);

  const comic = buildAssSubtitles({
    captions: [{ id: 'f2', start: 0, end: 2, text: 'Big insight here', highlightWords: ['Big'] }],
    aspectRatio: '1:1',
    resolution: '720p',
    captionStyle: 'Comic Pop',
    fontFamily: 'DM Sans',
    highlightColor: '#FBBF24',
  });
  assert.match(comic, /BIG/);
  assert.match(comic, /\\frz-2/);

  const typewriter = buildAssSubtitles({
    captions: [{ id: 'f3', start: 0, end: 2, text: 'Ship daily', highlightWords: [] }],
    aspectRatio: '16:9',
    resolution: '720p',
    captionStyle: 'Typewriter',
    fontFamily: 'Plus Jakarta Sans',
    highlightColor: '#38BDF8',
  });
  assert.match(typewriter, /JetBrains Mono/);
  assert.match(typewriter, /\\alpha&HFF&/);
});

test('buildVideoFilterGraph creates valid crop, scale, videoTheme, and optional ass filterchain', () => {
  const withAss = buildVideoFilterGraph({
    aspectRatio: '9:16',
    resolution: '720p',
    cropX: 0.75,
    videoTheme: 'Neon Cyber',
    assFilePath: '/tmp/subs.ass',
  });
  assert.match(withAss, /crop=/);
  assert.match(withAss, /0\.750/);
  assert.match(withAss, /scale=720:1280/);
  assert.match(withAss, /colorbalance=/);
  assert.match(withAss, /ass='\/tmp\/subs\.ass'/);

  const withoutAss = buildVideoFilterGraph({
    aspectRatio: '16:9',
    resolution: '1080p',
    cropX: 0.5,
    videoTheme: 'Original',
  });
  assert.match(withoutAss, /scale=1920:1080/);
  assert.doesNotMatch(withoutAss, /ass=/);
  assert.doesNotMatch(withoutAss, /colorbalance=/);
});

test('videoStyles normalizers safely sanitize unknown themes and caption styles', () => {
  assert.equal(normalizeVideoTheme('Neon Cyber'), 'Neon Cyber');
  assert.equal(normalizeVideoTheme('UnknownTheme'), 'Original');
  assert.equal(normalizeCaptionStyle('Comic Pop'), 'Comic Pop');
  assert.equal(normalizeCaptionStyle('UnknownStyle'), 'Modern');
  assert.match(getVideoThemeMeta('Noir Monochrome').ffmpegFilter, /hue=s=0/);
});

test('computeAudioChunkWindows chunks multi-hour videos cleanly', () => {
  const single = computeAudioChunkWindows(300, 720);
  assert.equal(single.length, 1);
  assert.deepEqual(single[0], { index: 0, startSec: 0, durationSec: 300 });

  const multi = computeAudioChunkWindows(1600, 720);
  assert.equal(multi.length, 3);
  assert.deepEqual(multi[0], { index: 0, startSec: 0, durationSec: 720 });
  assert.deepEqual(multi[1], { index: 1, startSec: 720, durationSec: 720 });
  assert.deepEqual(multi[2], { index: 2, startSec: 1440, durationSec: 160 });
});

test('clampClipWindow keeps clip boundaries strictly inside source video duration', () => {
  const shortWin = clampClipWindow(8, 25, 10, 1.5);
  assert.ok(shortWin.startSec >= 0);
  assert.ok(shortWin.endSec <= 10);
  assert.ok(shortWin.durationSec >= 1.5);

  const swapped = clampClipWindow(18, 12, 30, 1.5);
  assert.equal(swapped.startSec, 12);
  assert.equal(swapped.endSec, 18);
  assert.equal(swapped.durationSec, 6);
});

test('buildAssSubtitles supports Professional broadcast lower-third style', () => {
  const pro = buildAssSubtitles({
    captions: [{ id: 'p1', start: 0, end: 2.4, text: 'Scale systems cleanly', highlightWords: ['systems'] }],
    aspectRatio: '9:16',
    resolution: '1080p',
    captionStyle: 'Professional',
    fontFamily: 'Plus Jakarta Sans',
    highlightColor: '#38BDF8',
  });
  assert.match(pro, /Style: Default,Noto Sans/);
  assert.match(pro, /&HCC0F172A/);
  assert.match(pro, /,-1,0,0,0,100,100,0,0,3,8,1,2,/);
  assert.match(pro, /\\fad\(120,80\)/);
});

test('CAPTION_STYLES and getCaptionStyleMeta expose valid CSS and motion presets', () => {
  assert.equal(normalizeCaptionStyle('Professional'), 'Professional');

  const minimal = getCaptionStyleMeta('Minimal');
  assert.equal(minimal.motionKind, 'fade');
  assert.equal(minimal.recommendedFont, 'DM Sans');
  assert.ok(minimal.cssBoxClass.length > 0);

  const neon = getCaptionStyleMeta('Neon Glow');
  assert.equal(neon.motionKind, 'glow-pop');
  assert.equal(neon.recommendedFont, 'Plus Jakarta Sans');
  assert.equal(neon.recommendedHighlight, '#38BDF8');

  const pro = getCaptionStyleMeta('Professional');
  assert.equal(pro.motionKind, 'slide-up');
  assert.equal(pro.recommendedFont, 'Plus Jakarta Sans');
  assert.equal(pro.recommendedHighlight, '#38BDF8');

  assert.ok(CAPTION_STYLES.length >= 11);
  for (const preset of CAPTION_STYLES) {
    assert.ok(preset.shortName.length > 0);
    assert.ok(preset.motionLabel.length > 0);
    assert.ok(preset.cssBoxClass.length > 0);
  }
});

