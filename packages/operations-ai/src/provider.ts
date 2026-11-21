import type { OperationContext } from '@eclair-js/operation';

import type { Transcript } from './transcript.ts';

/** What `ai.transcribe` asks a provider to transcribe. */
export interface TranscriptionRequest {
    /** A 16 kHz mono PCM WAV file in the task's work directory. */
    audio: string;
    /** Seconds of audio. */
    duration: number;
    /** ISO 639-1 code, or `undefined` to detect the language. */
    language: string | undefined;
    /** A model of the provider, or `undefined` for its default. */
    model: string | undefined;
    /** Words and names likely to be spoken, to help the model spell them. */
    prompt: string | undefined;
}

export interface TranscriptionResult {
    transcript: Transcript;
    /** The model that answered, as the provider names it. */
    model: string | undefined;
    /** What the provider used, for the project's usage (decision 0008). */
    usage: { mediaSeconds: number; cost?: number };
}

/**
 * A transcription provider (decision 0008): `local-whisper` runs on the worker; a hosted API would
 * implement the same interface, enabled per project because it sends the audio to a third party.
 */
export interface TranscriptionProvider {
    readonly name: string;
    /** Seconds of audio it accepts at most. Longer inputs fail with `limit_exceeded`. */
    readonly maxDuration: number;
    transcribe(
        context: OperationContext,
        request: TranscriptionRequest,
    ): Promise<TranscriptionResult>;
}
