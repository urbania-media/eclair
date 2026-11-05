import { describe, expect, it } from 'vitest';

import { hls } from './hls.ts';
import { poster } from './poster.ts';
import { thumbnails } from './thumbnails.ts';
import { transcode } from './transcode.ts';

describe('queues', () => {
    it('extracts frames on the cpu queue, so it never waits behind a transcode', () => {
        expect(thumbnails.capability).toBe('cpu');
        expect(poster.capability).toBe('cpu');
    });

    it('encodes on the video queue', () => {
        expect(transcode.capability).toBe('video');
        expect(hls.capability).toBe('video');
    });
});
