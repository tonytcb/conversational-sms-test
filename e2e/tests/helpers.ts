import crypto from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

/** Simulates the customer texting in: a Twilio-form-encoded inbound webhook. */
export async function sendInbound(
  request: APIRequestContext,
  opts: { from: string; to?: string; body: string },
): Promise<string> {
  const messageSid = 'SM' + crypto.randomBytes(16).toString('hex');
  const params: Record<string, string> = {
    MessageSid: messageSid,
    From: opts.from,
    To: opts.to ?? '+15550000000',
    Body: opts.body,
  };
  const res = await request.post(`${API_URL}/webhooks/twilio/sms`, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    form: params,
  });
  if (!res.ok()) throw new Error(`inbound webhook failed: ${res.status()}`);
  return messageSid;
}

/** Unique phone per run so tests don't collide with earlier data. */
export function uniquePhone(): string {
  const n = (Date.now() % 10_000_000).toString().padStart(7, '0');
  return `+1555${n}`;
}
