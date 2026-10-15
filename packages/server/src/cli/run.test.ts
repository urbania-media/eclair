import { describe, expect, it } from 'vitest';

import { BINARIES } from '../config/config.ts';
import { VERSION } from '../version.ts';
import { EXIT, runCli } from './run.ts';
import type { CliIo } from './run.ts';

function createIo(env: NodeJS.ProcessEnv = {}, stop: Promise<void> = Promise.resolve()) {
    const output = { stdout: '', stderr: '' };
    const io: CliIo = {
        stdout: (text) => {
            output.stdout += text;
        },
        stderr: (text) => {
            output.stderr += text;
        },
        env,
        waitForStop: () => stop,
    };
    return { io, output };
}

describe('runCli', () => {
    it('prints the help', async () => {
        const { io, output } = createIo();
        expect(await runCli(['--help'], io)).toBe(EXIT.ok);
        expect(output.stdout).toContain('Usage: eclair <command>');
    });

    it('prints the version', async () => {
        const { io, output } = createIo();
        expect(await runCli(['--version'], io)).toBe(EXIT.ok);
        expect(output.stdout).toBe(`${VERSION}\n`);
    });

    it('generates a secret key that the configuration accepts', async () => {
        const { io, output } = createIo();
        await runCli(['key:generate'], io);
        const key = output.stdout.trim();
        expect(Buffer.from(key, 'base64')).toHaveLength(32);

        const api = createIo({
            ECLAIR_SECRET_KEY: key,
            ECLAIR_PORT: '0',
            ECLAIR_LOG_LEVEL: 'silent',
        });
        expect(await runCli(['api'], api.io)).toBe(EXIT.ok);
    });

    it('refuses unknown commands and extra arguments', async () => {
        const unknown = createIo();
        expect(await runCli(['serve'], unknown.io)).toBe(EXIT.usage);
        expect(unknown.output.stderr).toContain('unknown command "serve"');

        const extra = createIo();
        expect(await runCli(['api', '--port', '80'], extra.io)).toBe(EXIT.usage);
    });

    it('refuses to start with an invalid configuration', async () => {
        const { io, output } = createIo({ ECLAIR_PORT: 'eighty' });
        expect(await runCli(['api'], io)).toBe(EXIT.config);
        expect(output.stderr).toContain('ECLAIR_PORT must be a port number.');
    });

    it('starts the API and stops it on the stop signal', async () => {
        let stop = () => {};
        const stopped = new Promise<void>((resolve) => {
            stop = resolve;
        });
        const { io } = createIo({ ECLAIR_PORT: '0', ECLAIR_LOG_LEVEL: 'silent' }, stopped);
        const running = runCli(['api'], io);
        stop();
        expect(await running).toBe(EXIT.ok);
    });

    it('says that workers are not available yet', async () => {
        const { io } = createIo();
        expect(await runCli(['worker'], io)).toBe(EXIT.unavailable);
    });

    it('reports the configuration problems in doctor', async () => {
        const { io, output } = createIo({ ECLAIR_QUEUES: 'turbo' });
        expect(await runCli(['doctor'], io)).toBe(EXIT.config);
        expect(output.stdout).toContain('error ECLAIR_QUEUES: "turbo" is not a queue');
    });

    it('reports missing settings and binaries in doctor', async () => {
        // Missing binaries answer at once: the test doesn't depend on what this machine has.
        const binaries = Object.fromEntries(
            Object.entries(BINARIES).map(([name, variable]) => [variable, `/nonexistent/${name}`]),
        );
        const { io, output } = createIo(binaries);
        expect(await runCli(['doctor'], io)).toBe(EXIT.failure);
        expect(output.stdout).toContain('error DATABASE_URL is not set');
        expect(output.stdout).toContain('warn  ffmpeg: not found (/nonexistent/ffmpeg)');
    });
});
