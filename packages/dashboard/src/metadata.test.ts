import { describe, expect, it } from 'vitest';

import { flattenMetadata, shorten } from './metadata.ts';

describe('metadata', () => {
    it('flattens nested objects into dot paths', () => {
        expect(
            flattenMetadata({
                mediaId: '42',
                mediatheque: {
                    run: 'run_01M66WR189DQ1YH99JP3W54FD1',
                    pipeline: 'video',
                    options: { thumbnails: 5 },
                },
                tags: ['a', 'b'],
                draft: false,
                parent: null,
            }),
        ).toEqual([
            ['mediaId', '42'],
            ['mediatheque.run', 'run_01M66WR189DQ1YH99JP3W54FD1'],
            ['mediatheque.pipeline', 'video'],
            ['mediatheque.options.thumbnails', '5'],
            ['tags', '["a","b"]'],
            ['draft', 'false'],
            ['parent', 'null'],
        ]);
        expect(flattenMetadata(null)).toEqual([]);
        expect(flattenMetadata(undefined)).toEqual([]);
        expect(flattenMetadata({})).toEqual([]);
    });

    it('shortens long values in their middle, keeping their prefix and end', () => {
        expect(shorten('video')).toBe('video');
        expect(shorten('run_01M66WR189DQ1YH99JP3W54FD1')).toBe('run_01M66WR…4FD1');
        expect(shorten('run_01M66WR189DQ1YH99JP3W54FD1')).toHaveLength(16);
        expect(shorten('0123456789abcdef')).toBe('0123456789abcdef');
    });
});
