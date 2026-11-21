import type { Operation } from '@eclair-js/operation';

import { transcribe } from './transcribe.ts';

export { transcribe };
export { cuesOf, formatTimestamp, toJson, toSrt, toWebVtt } from './formats.ts';
export {
    LOCAL_WHISPER_DEFAULTS,
    localWhisper,
    localWhisperSettings,
    parseWhisperJson,
} from './local-whisper.ts';
export type { LocalWhisperSettings } from './local-whisper.ts';
export type {
    TranscriptionProvider,
    TranscriptionRequest,
    TranscriptionResult,
} from './provider.ts';
export type { Transcript, TranscriptSegment, TranscriptWord } from './transcript.ts';

/** The operations of this package, as the server loads them. */
const operations: readonly Operation[] = [transcribe];

export default operations;
