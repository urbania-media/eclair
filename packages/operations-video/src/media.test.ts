import { describe, expect, it } from 'vitest';

import { fitSize, frameEncoderArgs, sizeForShortSide } from './media.ts';

describe('fitSize', () => {
    it('fits a box, keeping the aspect ratio, with even sides', () => {
        expect(fitSize(1920, 1080, 1280, undefined)).toEqual({ width: 1280, height: 720 });
        expect(fitSize(1920, 1080, 1000, 1000)).toEqual({ width: 1000, height: 562 });
        expect(fitSize(1080, 1920, undefined, 640)).toEqual({ width: 360, height: 640 });
    });

    it('never enlarges, and makes odd sizes even', () => {
        expect(fitSize(320, 180, 1920, 1080)).toEqual({ width: 320, height: 180 });
        expect(fitSize(321, 181, undefined, undefined)).toEqual({ width: 320, height: 180 });
    });
});

describe('sizeForShortSide', () => {
    it('sets the short side, whatever the orientation', () => {
        expect(sizeForShortSide(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
        expect(sizeForShortSide(1080, 1920, 720)).toEqual({ width: 720, height: 1280 });
        expect(sizeForShortSide(1000, 1000, 360)).toEqual({ width: 360, height: 360 });
    });
});

describe('frameEncoderArgs', () => {
    it('maps the quality to the scale of each encoder', () => {
        expect(frameEncoderArgs('jpeg', 100)).toEqual(['-c:v', 'mjpeg', '-q:v', '2']);
        expect(frameEncoderArgs('jpeg', 1)).toEqual(['-c:v', 'mjpeg', '-q:v', '31']);
        expect(frameEncoderArgs('webp', 80)).toEqual(['-c:v', 'libwebp', '-quality', '80']);
        expect(frameEncoderArgs('png', 80)).toEqual(['-c:v', 'png']);
    });
});
