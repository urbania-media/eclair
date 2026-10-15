import { createHmac } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';

import { safeEqual } from '../crypto.ts';
import { LocalDriver } from '../storages/drivers/local.ts';
import { S3Driver } from '../storages/drivers/s3.ts';
import { checkStoragePath } from '../storages/drivers/types.ts';
import type { TemporaryStorage } from '../storages/temporary.ts';

/** The longest an S3 presigned URL can last: 7 days. */
const MAX_PRESIGN = 7 * 24 * 3600;

interface TokenData {
    /** Project id. */
    p: string;
    /** Path in the project's temporary storage. */
    f: string;
    /** Mime type. */
    m: string;
    /** Expiry, in seconds since the epoch. */
    e: number;
}

export interface LinkedFile {
    projectId: string;
    path: string;
    mime: string;
    expiresAt: Date;
}

/**
 * Download links for the files of the temporary storage (decision 0011): the bucket's presigned
 * URLs, or `GET /v1/files/{token}` with a local directory. A token is signed with
 * `ECLAIR_SECRET_KEY` and expires with its file.
 */
export class FileLinks {
    readonly #temporary: TemporaryStorage;
    readonly #secretKey: Buffer;
    readonly #publicUrl: string | undefined;

    constructor(temporary: TemporaryStorage, secretKey: Buffer, publicUrl: string | undefined) {
        this.#temporary = temporary;
        this.#secretKey = secretKey;
        this.#publicUrl = publicUrl;
    }

    #sign(payload: string): string {
        return createHmac('sha256', this.#secretKey)
            .update(`eclair-file.${payload}`)
            .digest('base64url');
    }

    token(file: LinkedFile): string {
        const data: TokenData = {
            p: file.projectId,
            f: file.path,
            m: file.mime,
            e: Math.floor(file.expiresAt.getTime() / 1000),
        };
        const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
        return `${payload}.${this.#sign(payload)}`;
    }

    /** The file of a token, or `undefined` when it's changed, expired or not a token. */
    verify(token: string, now = Date.now()): LinkedFile | undefined {
        const [payload, signature, extra] = token.split('.');
        if (payload === undefined || signature === undefined || extra !== undefined) {
            return undefined;
        }
        if (!safeEqual(signature, this.#sign(payload))) {
            return undefined;
        }
        let data: TokenData;
        try {
            data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenData;
            checkStoragePath(data.f);
        } catch {
            return undefined;
        }
        if (data.e * 1000 <= now) {
            return undefined;
        }
        return {
            projectId: data.p,
            path: data.f,
            mime: data.m,
            expiresAt: new Date(data.e * 1000),
        };
    }

    /** A download URL for a file of the temporary storage, or `undefined` when there can't be one. */
    async url(file: LinkedFile): Promise<string | undefined> {
        const seconds = Math.floor((file.expiresAt.getTime() - Date.now()) / 1000);
        if (seconds <= 0) {
            return undefined;
        }
        const { backend } = this.#temporary;
        if (backend instanceof S3Driver) {
            return backend.presign(
                `${file.projectId}/${file.path}`,
                Math.min(seconds, MAX_PRESIGN),
            );
        }
        if (backend instanceof LocalDriver && this.#publicUrl !== undefined) {
            return `${this.#publicUrl}/v1/files/${this.token(file)}`;
        }
        return undefined;
    }

    /** Opens a file of a local temporary storage. `undefined` when it isn't there anymore. */
    async open(file: LinkedFile): Promise<{ stream: Readable; size: number } | undefined> {
        const { backend } = this.#temporary;
        if (!(backend instanceof LocalDriver)) {
            return undefined;
        }
        const path = backend.localPath(`${file.projectId}/${file.path}`);
        try {
            const { size } = await stat(path);
            return { stream: createReadStream(path), size };
        } catch {
            return undefined;
        }
    }
}
