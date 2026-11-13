import type { OperationPlugin } from '@eclair-js/operation';

import { embedProbe } from './probe.ts';
import { PROVIDERS } from './providers/index.ts';

export { embedProbe } from './probe.ts';

/** The embed operations and the providers they read (decision 0022). */
const plugin = {
    operations: [embedProbe],
    embedProviders: [...PROVIDERS.values()].map(({ provider }) => provider),
} satisfies OperationPlugin;

export default plugin;
