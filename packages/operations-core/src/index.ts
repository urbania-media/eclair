import type { Operation } from '@eclair-js/operation';

import { probe } from './probe.ts';

export { probe };

/** The operations of this package, as the server loads them. */
const operations: readonly Operation[] = [probe];

export default operations;
