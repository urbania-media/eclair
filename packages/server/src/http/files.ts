import type { FastifyInstance } from 'fastify';

import type { FileLinks } from '../files/links.ts';
import { problems } from './problem.ts';

/**
 * `GET /v1/files/{token}`: downloads a file of a local temporary storage. No API key: the token is
 * the authorization. Anything wrong with it is a 404, so it says nothing about what exists.
 */
export async function fileRoutes(
    app: FastifyInstance,
    options: { links: FileLinks },
): Promise<void> {
    app.get('/files/:token', async (request, reply) => {
        const { token } = request.params as { token: string };
        const file = token.length <= 4096 ? options.links.verify(token) : undefined;
        const opened = file === undefined ? undefined : await options.links.open(file);
        if (file === undefined || opened === undefined) {
            throw problems.notFound('There is no file at this address, or it expired.');
        }
        return reply
            .headers({
                'content-type': file.mime,
                'content-length': String(opened.size),
                'cache-control': 'private, no-store',
                'x-content-type-options': 'nosniff',
                'content-disposition': 'attachment',
            })
            .send(opened.stream);
    });
}
