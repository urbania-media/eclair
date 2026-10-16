import type { Operation } from '@eclair-js/operation';

import { convert } from './convert.ts';

export { convert };

/** The operations of this package, as the server loads them. */
const operations: readonly Operation[] = [convert];

export default operations;
