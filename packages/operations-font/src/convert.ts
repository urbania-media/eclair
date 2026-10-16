import { join } from 'node:path';
import { Type } from 'typebox';

import { OperationError, defineOperation } from '@eclair-js/operation';

type Format = 'woff2' | 'woff';

const FORMATS: Record<Format, { file: string; mime: string }> = {
    woff2: { file: 'font.woff2', mime: 'font/woff2' },
    woff: { file: 'font.woff', mime: 'font/woff' },
};

const ConvertOptions = Type.Object(
    {
        formats: Type.Array(Type.Union([Type.Literal('woff2'), Type.Literal('woff')]), {
            minItems: 1,
            uniqueItems: true,
            default: ['woff2', 'woff'],
            description: 'Formats to write. The first one is the main file.',
        }),
        unicodes: Type.Optional(
            Type.Array(
                Type.String({
                    pattern: '^(U\\+)?[0-9A-Fa-f]{1,6}(-(U\\+)?[0-9A-Fa-f]{1,6})?$',
                }),
                {
                    minItems: 1,
                    maxItems: 1000,
                    description:
                        'Keeps only these characters, as code points or ranges (`U+0020-007E`, `00E9`).',
                },
            ),
        ),
        text: Type.Optional(
            Type.String({
                minLength: 1,
                maxLength: 10_000,
                description: 'Keeps only the characters of this text, with `unicodes` if both.',
            }),
        ),
    },
    { additionalProperties: false },
);

/**
 * Arguments of `fonttools subset` that keep what the browser uses: every glyph unless asked
 * otherwise, every layout feature, the names and the hinting.
 */
const KEEP = [
    '--layout-features=*',
    '--name-IDs=*',
    '--name-languages=*',
    '--name-legacy',
    '--notdef-glyph',
    '--notdef-outline',
    '--glyph-names',
    '--legacy-kern',
    '--symbol-cmap',
    '--legacy-cmap',
];

/**
 * WOFF2 and WOFF from a TrueType, OpenType, WOFF or WOFF2 font, the web fonts of
 * laravel-mediatheque's `WebFonts` job, with optional subsetting. EOT and SVG fonts, which that job
 * also wrote, are left out: no current browser needs them.
 */
export const convert = defineOperation({
    name: 'font.convert',
    version: 1,
    description:
        'WOFF2 and WOFF from a TrueType, OpenType, WOFF or WOFF2 font, optionally subset to some characters.',
    accepts: { kinds: ['font'] },
    capability: 'cpu',
    binaries: ['fonttools'],
    options: ConvertOptions,
    outputs: { files: true, metadata: true },

    async run(context, options) {
        const subset = options.unicodes !== undefined || options.text !== undefined;
        const characters = [
            ...(options.unicodes === undefined
                ? []
                : [
                      `--unicodes=${options.unicodes.map((code) => code.replaceAll('U+', '')).join(',')}`,
                  ]),
            ...(options.text === undefined ? [] : [`--text=${options.text}`]),
        ];
        for (const [index, format] of options.formats.entries()) {
            const { file, mime } = FORMATS[format];
            const path = join(context.workdir, file);
            try {
                await context.exec('fonttools', [
                    'subset',
                    context.input.path,
                    `--output-file=${path}`,
                    `--flavor=${format}`,
                    ...(subset ? characters : ['--unicodes=*', '--glyphs=*']),
                    ...KEEP,
                ]);
            } catch (error) {
                throw new OperationError('input_unreadable', "The file can't be read as a font.", {
                    cause: error,
                });
            }
            context.output(file, path, { mime, role: index === 0 ? 'main' : format });
            context.progress((index + 1) / options.formats.length);
        }
        return { metadata: { formats: options.formats, subset } };
    },
});
