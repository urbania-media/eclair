import type { Operation } from '@eclair-js/operation';

import { hls } from './hls.ts';
import { poster } from './poster.ts';
import { thumbnails } from './thumbnails.ts';
import { transcode } from './transcode.ts';

export { hls, poster, thumbnails, transcode };

/** The operations of this package, as the server loads them. */
const operations: readonly Operation[] = [transcode, thumbnails, poster, hls];

export default operations;
