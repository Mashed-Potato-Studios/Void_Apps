import { defineScheduled } from 'void';
import { stagingHeartbeat } from '../src/jobs/staging-heartbeat.js';

export const cron = '0 4 * * *';

export default defineScheduled(stagingHeartbeat);
