import { expect, test } from '@playwright/test';
import { sendInbound, uniquePhone } from './helpers';

test('inbound SMS appears in the admin UI and receives a sent reply', async ({ page, request }) => {
  const phone = uniquePhone();

  await sendInbound(request, { from: phone, body: 'e2e hello there' });

  await page.goto('/');
  const convItem = page.getByTestId('conversation-item').filter({ hasText: phone });
  await expect(convItem).toBeVisible();

  await convItem.click();
  const detail = page.getByTestId('conversation-detail');
  await expect(detail.getByText('e2e hello there')).toBeVisible();

  // worker takes 3–15s, then the reply shows up as sent/delivered
  const outbound = page.getByTestId('message-outbound');
  await expect(outbound).toBeVisible({ timeout: 30_000 });
  await expect(detail.getByTestId('status-badge').filter({ hasText: /sent|delivered/ }).first()).toBeVisible({
    timeout: 30_000,
  });
});

test('duplicate inbound delivery does not create a second conversation/message', async ({ page, request }) => {
  const phone = uniquePhone();
  const crypto = await import('node:crypto');
  const sid = 'SM' + crypto.randomBytes(16).toString('hex');
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001';

  // Send the SAME MessageSid twice.
  const post = async () => {
    const params: Record<string, string> = {
      MessageSid: sid,
      From: phone,
      To: '+15550000000',
      Body: 'dup test',
    };
    const res = await request.post(`${apiUrl}/webhooks/twilio/sms`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      form: params,
    });
    expect(res.ok()).toBeTruthy();
  };
  await post();
  await post();

  await page.goto('/');
  const convItem = page.getByTestId('conversation-item').filter({ hasText: phone });
  await expect(convItem).toBeVisible();
  await convItem.click();

  // Exactly one inbound message despite two deliveries.
  await expect(page.getByTestId('message-inbound')).toHaveCount(1);
});
