import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { toProblemErrors, validate } from './index.ts';
import type { SchemaName } from './index.ts';

/** The JSON code blocks of a Markdown file of the repository, in order. */
function readJsonExamples(path: string): unknown[] {
    const markdown = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
    return [...markdown.matchAll(/```json\n([\s\S]*?)```/g)].map(([, json]) =>
        JSON.parse(json ?? ''),
    );
}

function pointers(name: SchemaName, value: unknown): string[] {
    const result = validate(name, value);
    return result.valid ? [] : result.errors.map((error) => error.pointer);
}

const job = {
    input: { storage: 'media', path: 'uploads/interview.mov' },
    output: { storage: 'media', prefix: 'videos/42/' },
    tasks: { probe: { op: 'probe' } },
};

describe('the examples of the docs', () => {
    it('validate in docs/protocol.md', () => {
        const [jobRequest, taskRequest, jobResponse, ...others] =
            readJsonExamples('docs/protocol.md');
        expect(others).toEqual([]);
        expect(validate('JobRequest', jobRequest)).toMatchObject({ valid: true });
        expect(validate('TaskRequest', taskRequest)).toMatchObject({ valid: true });
        expect(validate('Job', jobResponse)).toMatchObject({ valid: true });
    });

    it('validate in the README', () => {
        const [jobRequest, ...others] = readJsonExamples('README.md');
        expect(others).toEqual([]);
        expect(validate('JobRequest', jobRequest)).toMatchObject({ valid: true });
    });
});

describe('JobRequest', () => {
    it('accepts a preset alone', () => {
        expect(pointers('JobRequest', { input: job.input, preset: 'mediatheque/video' })).toEqual(
            [],
        );
    });

    it('needs an input and a pipeline', () => {
        expect(pointers('JobRequest', {})).toContain('/input');
        expect(pointers('JobRequest', { input: job.input })).toContain('/tasks');
        expect(pointers('JobRequest', { input: job.input, tasks: {} })).toContain('/tasks');
    });

    it('refuses unknown fields, and points at them', () => {
        expect(pointers('JobRequest', { ...job, callback: 'https://example.com' })).toEqual([
            '/callback',
        ]);
        expect(
            pointers('JobRequest', { ...job, tasks: { probe: { op: 'probe', option: {} } } }),
        ).toEqual(['/tasks/probe/option']);
    });

    it('takes an input from a URL or a storage, not both', () => {
        expect(
            pointers('JobRequest', { ...job, input: { url: 'https://example.com/a.mov' } }),
        ).toEqual([]);
        expect(
            pointers('JobRequest', {
                ...job,
                input: { url: 'https://example.com/a.mov', storage: 'media', path: 'a.mov' },
            }),
        ).not.toEqual([]);
    });

    it('only fetches and calls https URLs', () => {
        expect(
            pointers('JobRequest', { ...job, input: { url: 'http://example.com/a.mov' } }),
        ).not.toEqual([]);
        expect(pointers('JobRequest', { ...job, webhook: 'http://example.com/hook' })).toContain(
            '/webhook',
        );
    });

    it('checks task names, operations and references', () => {
        expect(
            pointers('JobRequest', { ...job, tasks: { 'thumbnails:0': { op: 'probe' } } }),
        ).toContain('/tasks/thumbnails:0');
        expect(
            pointers('JobRequest', { ...job, tasks: { a: { op: 'Video.Transcode' } } }),
        ).toContain('/tasks/a/op');
        expect(
            pointers('JobRequest', {
                ...job,
                tasks: { a: { op: 'video.hls@1', from: 'h264:master', after: ['probe'] } },
            }),
        ).toEqual([]);
        expect(pointers('JobRequest', { ...job, tasks: { a: { op: 'video.hls@0' } } })).toContain(
            '/tasks/a/op',
        );
    });

    it('checks the priority and conditions', () => {
        expect(pointers('JobRequest', { ...job, priority: 'urgent' })).toContain('/priority');
        expect(
            pointers('JobRequest', {
                ...job,
                tasks: { a: { op: 'probe', when: { kind: ['video'], mime: ['video/*'] } } },
            }),
        ).toEqual([]);
        expect(
            pointers('JobRequest', {
                ...job,
                tasks: { a: { op: 'probe', when: { kind: ['movie'] } } },
            }),
        ).toContain('/tasks/a/when/kind/0');
    });

    it("doesn't change the value", () => {
        const value = structuredClone(job);
        validate('JobRequest', value);
        expect(value).toEqual(job);
    });
});

describe('toProblemErrors', () => {
    it('groups messages by pointer', () => {
        const result = validate('JobRequest', { input: {}, priority: 'urgent', tasks: {} });
        expect(result.valid).toBe(false);
        const errors = toProblemErrors(result.valid ? [] : result.errors);
        expect(Object.keys(errors)).toEqual(expect.arrayContaining(['/priority', '/input/url']));
        expect(validate('Problem', { title: 'Invalid', status: 422, errors })).toMatchObject({
            valid: true,
        });
    });
});
