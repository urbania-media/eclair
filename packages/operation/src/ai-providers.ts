import type { TSchema } from 'typebox';

import type { JsonSchemaObject, ProviderCapability } from './operation.ts';

const PROVIDER_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/**
 * An AI provider, as a plugin declares it for the server (decision 0008): its name, the capability
 * it answers, whether it sends media to a third party, and the schema of a project's credentials.
 * The operations of the plugin call it.
 */
export interface AiProviderDefinition {
    /** `local-whisper`, `amazon-transcribe`. */
    name: string;
    /** For people: `Amazon Transcribe`. */
    title: string;
    capability: ProviderCapability;
    /**
     * Whether it sends media to a third party. A project uses an external provider only when its
     * settings list it and allow external providers explicitly (`externalAiProviders`).
     */
    external: boolean;
    /** JSON Schema of a project's credentials (`{ accessKeyId, … }`), for external providers. */
    credentials?: TSchema | JsonSchemaObject;
    /**
     * Checks a task's options against what the provider supports, when the job is created: by
     * option name, the problems. A locale the provider doesn't know is refused there rather than
     * when the task runs.
     */
    checkOptions?(options: Readonly<Record<string, unknown>>): Record<string, string> | undefined;
}

export type AiProvider = Readonly<AiProviderDefinition>;

/** Declares an AI provider. Checks its name, so a broken plugin fails when it loads. */
export function defineAiProvider(definition: AiProviderDefinition): AiProvider {
    if (!PROVIDER_PATTERN.test(definition.name)) {
        throw new TypeError(
            `"${definition.name}" is not a provider name: use lowercase letters, digits and -.`,
        );
    }
    return Object.freeze({ ...definition });
}
