import type { OperationPlugin } from '@eclair-js/operation';

import { amazonTranscribeProvider } from './amazon-transcribe.ts';
import { localWhisperProvider } from './local-whisper.ts';
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

export {
    AmazonTranscribeCredentials,
    amazonTranscribe,
    amazonTranscribeProvider,
    amazonTranscribeSettings,
    parseAmazonTranscript,
} from './amazon-transcribe.ts';
export type { AmazonTranscribeSettings, AwsClients } from './amazon-transcribe.ts';
export { localWhisperProvider } from './local-whisper.ts';

/** The operations and AI providers of this package, as the server loads them. */
const plugin: OperationPlugin = {
    operations: [transcribe],
    aiProviders: [localWhisperProvider, amazonTranscribeProvider],
};

export default plugin;
