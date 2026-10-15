import { Redis } from 'ioredis';

/**
 * A Redis connection for BullMQ and Eclair's own keys. `maxRetriesPerRequest: null` is what BullMQ
 * needs for its blocking commands.
 */
export function createRedis(url: string, name = 'eclair'): Redis {
    return new Redis(url, { maxRetriesPerRequest: null, connectionName: name });
}

/** Prefix of every Redis key of Eclair, BullMQ's included. */
export const REDIS_PREFIX = 'eclair';
