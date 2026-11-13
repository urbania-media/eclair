import type { OperationPlugin } from '@eclair-js/operation';

import { embedDownload } from './download.ts';
import { embedProbe } from './probe.ts';
import { PROVIDERS } from './providers/index.ts';
import { embedThumbnail } from './thumbnail.ts';

export { embedDownload } from './download.ts';
export { embedProbe } from './probe.ts';
export { embedThumbnail } from './thumbnail.ts';

/** The embed operations and the providers they read (decision 0022). */
const plugin = {
    operations: [embedProbe, embedDownload, embedThumbnail],
    embedProviders: [...PROVIDERS.values()].map(({ provider }) => provider),
} satisfies OperationPlugin;

export default plugin;
