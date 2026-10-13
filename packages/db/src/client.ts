import * as schema from './schema/index.js';

/**
 * Database client schema export.
 * In a Void application runtime, `db` is inferred and provided via `void/db`.
 * This client helper defines the schema shape for ORM query inference.
 */
export const dbSchema = schema;
export type DBSchema = typeof schema;
