// Writes the files generated from schema/openapi.json: the JSON Schema bundle and the TypeScript
// types. Run `npm run generate -w @eclair-js/protocol` after changing the OpenAPI document. A test
// fails when they are out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import openapiTS, { astToString } from 'openapi-typescript';

import { createJsonSchema } from '../src/bundle.ts';
import type { OpenApiDocument } from '../src/document.ts';

const root = new URL('../', import.meta.url);

const HEADER = '// Generated from schema/openapi.json by `npm run generate`. Do not edit.\n\n';

/** The generated files, by path from the package root. */
export async function generate(): Promise<Record<string, string>> {
    const document = JSON.parse(
        readFileSync(new URL('schema/openapi.json', root), 'utf8'),
    ) as OpenApiDocument;
    const ast = await openapiTS(structuredClone(document) as never, {
        alphabetize: false,
        defaultNonNullable: false,
        exportType: false,
    });
    return {
        'schema/eclair.schema.json': `${JSON.stringify(createJsonSchema(document), null, 4)}\n`,
        'src/generated/openapi.ts': HEADER + astToString(ast),
    };
}

if (import.meta.main) {
    for (const [path, content] of Object.entries(await generate())) {
        writeFileSync(new URL(path, root), content);
        console.log(`Wrote ${path}`);
    }
}
