import type { Operation } from '@eclair-js/operation';

import { convert } from './convert.ts';
import { palette } from './palette.ts';
import { thumbnail } from './thumbnail.ts';

export { convert, palette, thumbnail };

/** The operations of this package, as the server loads them. */
const operations: readonly Operation[] = [convert, thumbnail, palette];

export default operations;
