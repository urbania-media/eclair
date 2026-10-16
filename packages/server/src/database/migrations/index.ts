import type { Migration } from 'kysely/migration';

import type { Dialect } from '../dialect.ts';
import { initial } from './0001-initial.ts';
import { uploadParts } from './0002-upload-parts.ts';
import { previousWebhookSecret } from './0003-previous-webhook-secret.ts';

/**
 * Every migration, in order. A migration is never changed once released: changes to the schema
 * are new migrations, additive within a major version (see `docs/deployment.md`).
 */
export function migrations(dialect: Dialect): Record<string, Migration> {
    return {
        '0001-initial': initial(dialect),
        '0002-upload-parts': uploadParts(dialect),
        '0003-previous-webhook-secret': previousWebhookSecret(dialect),
    };
}
