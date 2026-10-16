import type { Operation } from '@eclair-js/operation';

import { transcode } from './transcode.ts';
import { waveform } from './waveform.ts';

export { transcode, waveform };

/** The operations of this package, as the server loads them. */
const operations: readonly Operation[] = [transcode, waveform];

export default operations;
