import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const voidFlowExecutions = sqliteTable('void_flow_executions', {
  id: text('id').primaryKey(),
  workflowName: text('workflow_name').notNull(),
  status: text('status', {
    enum: ['pending', 'running', 'sleeping', 'waiting_event', 'completed', 'failed', 'canceled'],
  }).notNull().default('pending'),
  input: text('input').notNull(), // JSON stringified
  output: text('output'), // JSON stringified
  error: text('error'),
  currentStepIndex: integer('current_step_index').default(0).notNull(),
  wakeUpAt: integer('wake_up_at', { mode: 'timestamp' }),
  waitingForEventName: text('waiting_for_event_name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

export const voidFlowSteps = sqliteTable('void_flow_steps', {
  id: text('id').primaryKey(),
  executionId: text('execution_id').notNull().references(() => voidFlowExecutions.id, { onDelete: 'cascade' }),
  stepId: text('step_id').notNull(),
  stepType: text('step_type', { enum: ['run', 'sleep', 'wait_for_event', 'send_queue'] }).notNull(),
  status: text('status', { enum: ['running', 'completed', 'failed', 'skipped'] }).notNull(),
  output: text('output'), // JSON stringified
  error: text('error'),
  durationMs: integer('duration_ms'),
  attempts: integer('attempts').default(1).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
});

export const voidFlowEvents = sqliteTable('void_flow_events', {
  id: text('id').primaryKey(),
  eventName: text('event_name').notNull(),
  executionId: text('execution_id'),
  payload: text('payload').notNull(), // JSON stringified
  consumed: integer('consumed', { mode: 'boolean' }).default(false).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()).notNull(),
});

export type VoidFlowExecutionSelect = typeof voidFlowExecutions.$inferSelect;
export type VoidFlowExecutionInsert = typeof voidFlowExecutions.$inferInsert;
export type VoidFlowStepSelect = typeof voidFlowSteps.$inferSelect;
export type VoidFlowStepInsert = typeof voidFlowSteps.$inferInsert;
export type VoidFlowEventSelect = typeof voidFlowEvents.$inferSelect;
export type VoidFlowEventInsert = typeof voidFlowEvents.$inferInsert;
