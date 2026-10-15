import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXIT, runCli } from './run.ts';
import type { CliIo } from './run.ts';

let directory: string;
let env: NodeJS.ProcessEnv;

async function eclair(...args: string[]) {
    const output = { stdout: '', stderr: '' };
    const io: CliIo = {
        stdout: (text) => {
            output.stdout += text;
        },
        stderr: (text) => {
            output.stderr += text;
        },
        env,
        waitForStop: () => Promise.resolve(),
    };
    const code = await runCli(args, io);
    return { code, ...output };
}

beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'eclair-admin-'));
    env = {
        DATABASE_URL: `sqlite://${join(directory, 'eclair.db')}`,
        ECLAIR_SECRET_KEY: randomBytes(32).toString('base64'),
    };
    expect((await eclair('migrate')).code).toBe(EXIT.ok);
});

afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
});

describe('admin commands', () => {
    it('create and show a project', async () => {
        const created = await eclair(
            'projects:create',
            'niche',
            '--name',
            'Niche',
            '--webhook-url',
            'https://niche.example.com/eclair/webhook',
            '--set',
            'concurrency=8',
            '--set',
            'operations=["probe","video.transcode"]',
        );
        expect(created.code).toBe(EXIT.ok);
        const secret = /whsec_[\w-]+/.exec(created.stdout)?.[0];
        expect(secret).toBeDefined();

        const shown = await eclair('projects:show', 'niche');
        expect(JSON.parse(shown.stdout)).toMatchObject({
            slug: 'niche',
            name: 'Niche',
            settings: { concurrency: 8, operations: ['probe', 'video.transcode'] },
            keys: [],
            storages: [],
        });

        expect((await eclair('projects:secret', 'niche')).stdout).toBe(`${secret}\n`);
        expect((await eclair('projects:list')).stdout).toMatch(/niche\s+Niche\s+normal\s+active/);
    });

    it('update a project', async () => {
        const updated = await eclair(
            'projects:update',
            'niche',
            '--priority',
            'high',
            '--unset',
            'concurrency',
            '--no-webhook',
            '--disable',
        );
        expect(updated.code).toBe(EXIT.ok);
        expect(JSON.parse(updated.stdout)).toMatchObject({
            priority: 'high',
            webhookUrl: null,
            disabled: true,
            settings: { concurrency: 4 },
        });
        await eclair('projects:update', 'niche', '--enable');
    });

    it('create, list and revoke keys', async () => {
        const created = await eclair(
            'keys:create',
            'niche',
            '--name',
            'site',
            '--scopes',
            'jobs:read',
        );
        expect(created.code).toBe(EXIT.ok);
        expect(created.stdout).toMatch(/\(jobs:read\)/);
        const id = /key_\w+/.exec(created.stdout)?.[0] ?? '';

        expect((await eclair('keys:list', 'niche')).stdout).toMatch(
            /site\s+ek_[\w-]{8}…\s+jobs:read\s+never\s+active/,
        );
        expect((await eclair('keys:revoke', id)).code).toBe(EXIT.ok);
        expect((await eclair('keys:list', 'niche')).stdout).toContain('revoked');
    });

    it('set, list and remove storages', async () => {
        const config = join(directory, 'storage.json');
        writeFileSync(
            config,
            JSON.stringify({ bucket: 'niche-media', accessKeyId: 'a', secretAccessKey: 'b' }),
        );
        const saved = await eclair(
            'storages:set',
            'niche',
            'media',
            '--kind',
            's3',
            '--config',
            `@${config}`,
        );
        expect(saved).toMatchObject({
            code: EXIT.ok,
            stdout: 'Saved media: s3://niche-media/ (AWS us-east-1)\n',
        });

        const http = await eclair(
            'storages:set',
            'niche',
            'disk',
            '--kind',
            'http',
            '--config',
            '{"url":"https://niche.example.com/eclair/storage"}',
        );
        expect(http.code).toBe(EXIT.ok);
        expect((await eclair('storages:list', 'niche')).stdout).not.toContain('"b"');
        expect((await eclair('storages:remove', 'niche', 'disk')).code).toBe(EXIT.ok);
    });

    it('set, list and remove presets', async () => {
        const file = join(directory, 'preset.json');
        writeFileSync(file, JSON.stringify({ tasks: { probe: { op: 'probe' } } }));
        expect((await eclair('presets:set', 'web-video', '--file', file)).stdout).toBe(
            'Created global preset web-video, version 1.\n',
        );
        expect(
            (await eclair('presets:set', 'web-video', '--file', file, '--project', 'niche')).stdout,
        ).toBe('Created project preset web-video, version 1.\n');
        expect((await eclair('presets:list', '--project', 'niche')).stdout).toMatch(
            /web-video\s+project\s+1\s+probe/,
        );
        expect((await eclair('presets:remove', 'web-video')).code).toBe(EXIT.ok);
        expect((await eclair('presets:list')).stdout).toBe('Nothing yet.\n');
    });

    it('explain what went wrong', async () => {
        const unknown = await eclair('projects:show', 'nope');
        expect(unknown).toMatchObject({
            code: EXIT.failure,
            stderr: 'eclair: There is no project "nope".\n',
        });

        const invalid = await eclair('projects:create', 'Bad Slug');
        expect(invalid.code).toBe(EXIT.failure);
        expect(invalid.stderr).toContain('/slug: must match pattern');

        const missing = await eclair('projects:show');
        expect(missing).toMatchObject({ code: EXIT.usage, stderr: 'eclair: Missing <project>.\n' });

        const unsure = await eclair('projects:delete', 'niche');
        expect(unsure.code).toBe(EXIT.usage);
        expect((await eclair('projects:delete', 'niche', '--yes')).code).toBe(EXIT.ok);
    });
});
