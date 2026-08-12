/**
 * Types and constants shared by the SPA and the API.
 *
 * Types only — NO zod. Importing a schema from here would drag the whole
 * validation library into the client bundle; schemas live behind the
 * `@ai-travel/shared/schemas` export path, which only the server imports.
 */
export * from './api.types';
export * from './currency.types';
export * from './error-codes';
export * from './friend.types';
export * from './messages.types';
export * from './occupancy';
export * from './planner.types';
export * from './share.types';
export * from './travel.types';
