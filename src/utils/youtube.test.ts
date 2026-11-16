import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEstimatedViralScore,
  formatFileSize,
  formatTimecode,
  parseYouTubeUrl,
  splitTranscriptIntoCaptions,
} from './youtube';

test('parseYouTubeUrl validates standard, shortlink, and shorts URLs', () => {
  const standard = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=12s');
  assert.equal(standard.valid, true);
  assert.equal(standard.videoId, 'dQw4w9WgXcQ');
  assert.equal(standard.urlType, 'standard');

  const shortlink = parseYouTubeUrl('https://youtu.be/jNQXAC9IVRw?si=abc');
  assert.equal(shortlink.valid, true);
  assert.equal(shortlink.videoId, 'jNQXAC9IVRw');
  assert.equal(shortlink.urlType, 'shortlink');

  const shorts = parseYouTubeUrl('https://youtube.com/shorts/aqz-KE-bpKQ');
  assert.equal(shorts.valid, true);
  assert.equal(shorts.videoId, 'aqz-KE-bpKQ');
  assert.equal(shorts.urlType, 'shorts');
});

test('parseYouTubeUrl rejects invalid hosts or malformed video IDs', () => {
  assert.equal(parseYouTubeUrl('').valid, false);
  assert.equal(parseYouTubeUrl('https://vimeo.com/123456').valid, false);
  assert.equal(parseYouTubeUrl('https://youtube.com/watch?v=short').valid, false);
});

test('formatTimecode and formatFileSize format cleanly', () => {
  assert.equal(formatTimecode(0), '00:00');
  assert.equal(formatTimecode(65.4), '01:05');
  assert.equal(formatFileSize(512 * 1024), '512 KB');
  assert.equal(formatFileSize(3.5 * 1024 * 1024), '3.5 MB');
});

test('computeEstimatedViralScore computes bounded weighted score', () => {
  const score = computeEstimatedViralScore({
    hookStrength: 92,
    audienceRelevance: 88,
    emotionalImpact: 84,
    infoValue: 90,
    storyCompleteness: 85,
  });
  assert.ok(score >= 85 && score <= 95);
});

test('splitTranscriptIntoCaptions slices transcript cleanly within clip bounds', () => {
  const captions = splitTranscriptIntoCaptions(
    [
      {
        id: 'seg-1',
        start: 10,
        end: 20,
        text: 'This is a long sentence that should split into two readable subtitle lines cleanly.',
        speaker: 'Host',
      },
    ],
    12,
    18,
    6
  );
  assert.ok(captions.length >= 2);
  assert.equal(captions[0].start, 0);
  assert.ok(captions[captions.length - 1].end <= 6.5);
});
