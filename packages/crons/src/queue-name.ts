/**
 * Cloudflare queue-name grammar. Pure and runtime-neutral: shared by the
 * Node-only scanner and the portable dev dispatcher.
 *
 * The 63-character limit applies to the full Cloudflare queue name (Worker
 * name included), which a local scanner cannot know. This checks the local
 * `queues/` name only.
 */
export function validateQueueName(name: string): string | null {
  if (name.length === 0) return "queue name is empty";
  if (name.length > 63) return `queue name exceeds 63 characters (${name.length})`;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(name)) {
    return `invalid queue name "${name}" (letters, digits, and '-' only; must start and end with a letter or digit)`;
  }
  return null;
}
