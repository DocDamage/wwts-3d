import { describe, it, expect } from 'vitest';
import { normalizeAudioLink } from '../src/js/audioPlayer.js';

describe('Beat link normalization', () => {
  it('turns Dropbox share links into direct downloads', () => {
    const { url } = normalizeAudioLink('https://www.dropbox.com/s/abc123/beat.mp3?dl=0');
    expect(url).toContain('raw=1');
    expect(url).not.toContain('dl=0');
  });

  it('turns Google Drive file links into direct downloads', () => {
    const { url } = normalizeAudioLink('https://drive.google.com/file/d/FILEID42/view?usp=sharing');
    expect(url).toBe('https://drive.google.com/uc?export=download&id=FILEID42');
  });

  it('explains that streaming links cannot be played', () => {
    ['https://www.youtube.com/watch?v=x', 'https://youtu.be/x', 'https://soundcloud.com/a/b', 'https://open.spotify.com/track/1']
      .forEach(link => expect(normalizeAudioLink(link).error).toMatch(/Streaming links/));
  });

  it('passes direct audio links through untouched', () => {
    expect(normalizeAudioLink('https://example.com/beats/fire.wav').url).toBe('https://example.com/beats/fire.wav');
  });
});
