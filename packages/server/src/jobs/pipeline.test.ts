import { describe, expect, it } from 'vitest';

import { InvalidValueError } from '../validation.ts';
import { findCycle, mergeTasks, parseSource, resolvePipeline } from './pipeline.ts';
import { testRegistry } from './testing.ts';

const registry = testRegistry();
const settings = { concurrency: 4, maxDirectUpload: 1, probesPerMinute: 1, taskWebhooks: false };

function errorsOf(run: () => unknown): Record<string, string[]> {
    try {
        run();
    } catch (error) {
        if (error instanceof InvalidValueError) {
            return error.errors;
        }
        throw error;
    }
    return {};
}

describe('mergeTasks', () => {
    it('lets the job replace and add tasks of the preset', () => {
        expect(
            mergeTasks(
                { probe: { op: 'probe' }, h264: { op: 'video.transcode' } },
                {
                    h264: { op: 'video.transcode', options: { codec: 'vp9' } },
                    extra: { op: 'probe' },
                },
            ),
        ).toEqual({
            probe: { op: 'probe' },
            h264: { op: 'video.transcode', options: { codec: 'vp9' } },
            extra: { op: 'probe' },
        });
    });
});

describe('parseSource', () => {
    it('reads a task and an optional file', () => {
        expect(parseSource('h264')).toEqual({ task: 'h264', file: undefined });
        expect(parseSource('hls:master.m3u8')).toEqual({ task: 'hls', file: 'master.m3u8' });
    });
});

describe('resolvePipeline', () => {
    it('resolves operations, options with defaults and dependencies', () => {
        const tasks = resolvePipeline(
            {
                probe: { op: 'probe' },
                h264: { op: 'video.transcode', after: ['probe'] },
                hls: { op: 'video.hls@1', from: 'h264:out.mp4', keep: false },
            },
            registry,
            settings,
        );
        expect(
            tasks.map(({ name, operation, options, dependencies, keep, source }) => ({
                name,
                key: operation.key,
                options,
                dependencies,
                keep,
                source,
            })),
        ).toEqual([
            {
                name: 'probe',
                key: 'probe@1',
                options: { checksum: false },
                dependencies: [],
                keep: true,
                source: undefined,
            },
            {
                name: 'h264',
                key: 'video.transcode@1',
                options: { codec: 'h264' },
                dependencies: ['probe'],
                keep: true,
                source: undefined,
            },
            {
                name: 'hls',
                key: 'video.hls@1',
                options: {},
                dependencies: ['h264'],
                keep: false,
                source: { task: 'h264', file: 'out.mp4' },
            },
        ]);
    });

    it('reports every problem at once', () => {
        expect(
            errorsOf(() =>
                resolvePipeline(
                    {
                        a: { op: 'video.nope' },
                        b: { op: 'video.transcode', options: { codec: 'av1' } },
                        c: { op: 'video.hls', from: 'missing' },
                        d: { op: 'video.hls', from: 'probe' },
                        e: { op: 'probe', after: ['e', 'ghost'] },
                        probe: { op: 'probe' },
                    },
                    registry,
                    { ...settings, operations: ['probe', 'video.transcode', 'video.hls'] },
                ),
            ),
        ).toEqual({
            '/tasks/a/op': ['"video.nope" is not an operation of this server'],
            '/tasks/b/options/codec': expect.any(Array),
            '/tasks/c/from': ['there is no task "missing"'],
            '/tasks/d/from': ['probe (probe@1) writes no file'],
            '/tasks/e/after': ['a task cannot wait for itself', 'there is no task "ghost"'],
        });
    });

    it('refuses cycles', () => {
        expect(
            errorsOf(() =>
                resolvePipeline(
                    {
                        a: { op: 'video.hls', from: 'c' },
                        b: { op: 'video.hls', from: 'a' },
                        c: { op: 'video.hls', from: 'b' },
                    },
                    registry,
                    settings,
                ),
            ),
        ).toEqual({ '/tasks': ['the tasks wait for each other: a → c → b → a'] });
    });

    it('applies what the project may use', () => {
        expect(
            errorsOf(() =>
                resolvePipeline({ h264: { op: 'video.transcode' } }, registry, {
                    ...settings,
                    operations: ['probe'],
                }),
            ),
        ).toEqual({ '/tasks/h264/op': ['the project may not use video.transcode'] });
    });
});

describe('findCycle', () => {
    it('finds none in a graph without one', () => {
        expect(
            findCycle([
                { name: 'a', dependencies: [] },
                { name: 'b', dependencies: ['a'] },
            ]),
        ).toBeUndefined();
    });
});
