import { defineHandler } from 'void';
import { initialMenu } from '../../db/seed.js';

export const GET = defineHandler(async () => {
  return { success: true, data: initialMenu };
});
