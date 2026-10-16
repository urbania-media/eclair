import type { Operation } from '@eclair-js/operation';

import { thumbnails } from './thumbnails.ts';

export { thumbnails };

/** The operations of this package, as the server loads them. */
const operations: readonly Operation[] = [thumbnails];

export default operations;
