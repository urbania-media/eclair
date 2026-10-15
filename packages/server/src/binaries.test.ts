import { describe, expect, it } from 'vitest';

import { checkBinary } from './binaries.ts';

describe('checkBinary', () => {
    it('reports a missing binary', async () => {
        expect(await checkBinary('ffmpeg', '/nonexistent/ffmpeg')).toEqual({
            name: 'ffmpeg',
            path: '/nonexistent/ffmpeg',
            status: 'missing',
            output: undefined,
        });
    });

    it('reports the first line of a binary that runs', async () => {
        // `node -version` fails, `node --version` doesn't: use `node` for both outcomes.
        const status = await checkBinary('vips', process.execPath);
        expect(status).toMatchObject({ status: 'ok', output: process.version });
    });

    it('reports a binary that exits with an error', async () => {
        const status = await checkBinary('ffmpeg', process.execPath);
        expect(status.status).toBe('failed');
    });
});
