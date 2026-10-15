import { readFileSync } from 'node:fs';

/** The parts of an OpenAPI 3.1 document that this package reads. */
export interface OpenApiDocument {
    openapi: string;
    info: { title: string; version: string };
    paths: Record<string, Record<string, unknown>>;
    webhooks: Record<string, unknown>;
    components: { schemas: Record<string, JsonSchema> } & Record<string, unknown>;
}

export type JsonSchema = Record<string, unknown>;

function readSchemaFile<T>(name: string): T {
    // `src/` and `dist/` are both one level below `schema/`.
    return JSON.parse(readFileSync(new URL(`../schema/${name}`, import.meta.url), 'utf8')) as T;
}

/** The OpenAPI document of the protocol (`schema/openapi.json`). */
export const openapi: OpenApiDocument = readSchemaFile('openapi.json');

/**
 * The schemas of the OpenAPI document as one JSON Schema (`schema/eclair.schema.json`), for
 * validators that don't read OpenAPI.
 */
export const jsonSchema: JsonSchema = readSchemaFile('eclair.schema.json');
