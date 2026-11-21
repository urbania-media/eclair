#!/usr/bin/env node
// A stand-in for whisper.cpp's whisper-cli in the tests of ai.transcribe: it checks its arguments
// like whisper-cli, records them next to its output and writes a canned full JSON transcript.
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const value = (name) => {
    const index = args.indexOf(name);
    return index === -1 ? undefined : args[index + 1];
};
const model = value('--model');
const file = value('--file');
const output = value('--output-file');
if (model === undefined || !existsSync(model)) {
    process.stderr.write(`error: failed to load model '${model}'\n`);
    process.exit(3);
}
if (file === undefined || !existsSync(file) || output === undefined) {
    process.stderr.write('error: missing input or output\n');
    process.exit(2);
}
writeFileSync(`${output}.args.json`, JSON.stringify(args));
copyFileSync(new URL('./whisper-full.json', import.meta.url), `${output}.json`);
