import type { components } from './generated/openapi.ts';

type Schemas = components['schemas'];

export type JobRequest = Schemas['JobRequest'];
export type TaskRequest = Schemas['TaskRequest'];
export type Input = Schemas['Input'];
export type OutputTarget = Schemas['OutputTarget'];
export type TaskCondition = Schemas['TaskCondition'];
export type Job = Schemas['Job'];
export type JobStatus = Schemas['JobStatus'];
export type JobList = Schemas['JobList'];
export type JobEvent = Schemas['JobEvent'];
export type Task = Schemas['Task'];
export type TaskStatus = Schemas['TaskStatus'];
export type TaskError = Schemas['TaskError'];
export type TaskOutputs = Schemas['TaskOutputs'];
export type OutputFile = Schemas['OutputFile'];
export type PresetRequest = Schemas['PresetRequest'];
export type Preset = Schemas['Preset'];
export type PresetList = Schemas['PresetList'];
export type Operation = Schemas['Operation'];
export type OperationList = Schemas['OperationList'];
export type WebhookEvent = Schemas['WebhookEvent'];
export type Problem = Schemas['Problem'];
