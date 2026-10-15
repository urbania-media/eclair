import type { JsonSchema, OpenApiDocument } from './document.ts';
import { JSON_SCHEMA_ID } from './version.ts';

const COMPONENT_PREFIX = '#/components/schemas/';

function rewriteRefs(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(rewriteRefs);
    }
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, child]) => [
                key,
                key === '$ref' && typeof child === 'string' && child.startsWith(COMPONENT_PREFIX)
                    ? `#/$defs/${child.slice(COMPONENT_PREFIX.length)}`
                    : rewriteRefs(child),
            ]),
        );
    }
    return value;
}

/** Turns the schemas of an OpenAPI document into one JSON Schema with a `$defs` entry each. */
export function createJsonSchema(document: OpenApiDocument): JsonSchema {
    return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: JSON_SCHEMA_ID,
        title: `${document.info.title} protocol ${document.info.version}`,
        description:
            'Generated from openapi.json by `npm run generate`. Reference a definition with `urn:eclair:protocol:v1#/$defs/<name>`.',
        $defs: rewriteRefs(document.components.schemas),
    };
}
