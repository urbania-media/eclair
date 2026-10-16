export { CAPABILITIES, isCapability } from './capabilities.ts';
export type { Capability } from './capabilities.ts';
export { detectType, kindOf, matchesMime } from './detect.ts';
export type { DetectedType } from './detect.ts';
export { ERROR_CODES, OperationError } from './errors.ts';
export type { ErrorCode } from './errors.ts';
export { execBinary } from './exec.ts';
export { FFMPEG_DEMUXERS, ffmpegInput, ffmpegProgress } from './ffmpeg.ts';
export type { ExecOptions, ExecResult } from './exec.ts';
export { acceptsInput, defineOperation } from './operation.ts';
export type {
    JsonSchemaObject,
    Operation,
    OperationContext,
    OperationDefinition,
    OperationInput,
    OperationLogger,
    OperationPlugin,
    OperationResult,
    OutputOptions,
} from './operation.ts';
