import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAssSubtitles,
  buildVideoFilterGraph,
  formatAssTime,
  getTargetDimensions,
  hexToAssBgr,
} from './ffmpegArgs';

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
  assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:02\.50/);
  assert.match(ass, /\\kf/);
});

test('buildVideoFilterGraph creates valid crop, scale, and ass filterchain', () => {
  const filter = buildVideoFilterGraph({
    aspectRatio: '9:16',
    resolution: '720p',
    cropX: 0.75,
    assFilePath: '/tmp/subs.ass',
  });
  assert.match(filter, /crop=/);
  assert.match(filter, /0\.750/);
  assert.match(filter, /scale=720:1280/);
  assert.match(filter, /ass='\/tmp\/subs\.ass'/);
});
