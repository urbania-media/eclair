import { describe, expect, it } from 'vitest';

import { OperationError } from './errors.ts';
import { execBinary } from './exec.ts';

const node = process.execPath;

function script(code: string): string[] {
    return ['-e', code];
}

describe('execBinary', () => {
    it('returns stdout and stderr', async () => {
        const result = await execBinary(node, script('console.log("out"); console.error("err")'));
        expect(result).toEqual({ stdout: 'out\n', stderr: 'err\n' });
    });

    it('passes arguments without a shell', async () => {
        const result = await execBinary(node, [
            '-e',
            'console.log(process.argv[1])',
            '$(echo hacked); rm -rf /',
        ]);
        expect(result.stdout).toBe('$(echo hacked); rm -rf /\n');
    });

    it("doesn't pass the worker's secrets to the binary", async () => {
        process.env['ECLAIR_SECRET_KEY'] = 'top-secret';
        try {
            const result = await execBinary(
                node,
                script('console.log(Object.keys(process.env).join(","))'),
                {
                    env: { EXTRA: '1' },
                },
            );
            expect(result.stdout).not.toContain('ECLAIR_SECRET_KEY');
            expect(result.stdout).toContain('EXTRA');
        } finally {
            delete process.env['ECLAIR_SECRET_KEY'];
        }
    });

    it('fails with the exit code, and keeps stderr as the cause', async () => {
        const error = await execBinary(
            node,
            script('console.error("bad input"); process.exit(3)'),
        ).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(OperationError);
        expect(error).toMatchObject({
            code: 'operation_failed',
            message: expect.stringContaining('exited with 3'),
        });
        expect(String((error as Error).cause)).toContain('bad input');
    });

    it('kills a binary that takes too long', async () => {
        await expect(
            execBinary(node, script('setTimeout(() => {}, 10_000)'), { timeout: 100 }),
        ).rejects.toMatchObject({
            code: 'timeout',
        });
    });

    it('kills a binary on cancel', async () => {
        const controller = new AbortController();
        const running = execBinary(node, script('setTimeout(() => {}, 10_000)'), {
            signal: controller.signal,
        });
        setTimeout(() => controller.abort(), 50);
        await expect(running).rejects.toMatchObject({
            code: 'operation_failed',
            message: expect.stringContaining('canceled'),
        });
    });

    it('limits the output', async () => {
        await expect(
            execBinary(node, script('process.stdout.write("x".repeat(10_000))'), {
                maxOutput: 1000,
            }),
        ).rejects.toMatchObject({ code: 'limit_exceeded' });
    });

    it('writes the input to stdin', async () => {
        const result = await execBinary(node, script('process.stdin.pipe(process.stdout)'), {
            input: 'hello',
        });
        expect(result.stdout).toBe('hello');
    });

    it('fails clearly when the binary is missing', async () => {
        await expect(execBinary('/nonexistent/ffmpeg', [])).rejects.toMatchObject({
            code: 'operation_failed',
            message: 'ffmpeg could not start.',
        });
    });
});
