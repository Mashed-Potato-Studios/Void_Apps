import type { EmailQueuePayload } from '@void-monorepo/types';

/**
 * Void Cloudflare Queue Consumer
 * Handles asynchronous background messaging and email dispatches.
 */
export default async function handleQueue(batch: { messages: Array<{ id: string; body: EmailQueuePayload }> }) {
  console.log(`[Void Queue] Processing batch of ${batch.messages.length} email messages`);

  for (const message of batch.messages) {
    const payload = message.body;
    console.log(`[Void Queue] Sending '${payload.template}' email to ${payload.to} with subject: "${payload.subject}"`);
    // Connect to transactional email provider (Resend, SendGrid, Postmark)
  }

  return { success: true, processed: batch.messages.length };
}
