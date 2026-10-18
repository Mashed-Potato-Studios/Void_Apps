import { defineHandler } from 'void';
import type { InferProps } from 'void';
import { initialMenu } from '../db/seed.js';
import type { MenuItem } from '../db/schema.js';

export type MenuLoader = { menu: MenuItem[] };
export type Props = InferProps<typeof loader>;

// Degraded-mode: D1 read lands here once local D1 is provisioned (Task 6 wires
// `db from 'void/db'`); until then the seed keeps the page rendering.
export const loader = defineHandler(async (): Promise<MenuLoader> => {
  return { menu: initialMenu };
});
