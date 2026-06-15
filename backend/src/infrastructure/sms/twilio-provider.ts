import type { SmsProvider } from '../../domain/ports/services';

export interface TwilioConfig {
  baseUrl: string; // mountebank in dev, api.twilio.com in prod
  accountSid: string;
  authToken: string;
}

export class TwilioSmsProvider implements SmsProvider {
  constructor(private readonly cfg: TwilioConfig) {}

  async send(input: { to: string; from: string; body: string }): Promise<{ providerSid: string; status: string }> {
    const url = `${this.cfg.baseUrl}/2010-04-01/Accounts/${this.cfg.accountSid}/Messages.json`;
    const form = new URLSearchParams({ To: input.to, From: input.from, Body: input.body });

    const auth = Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString('base64');
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${auth}`,
      },
      body: form.toString(),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Twilio send failed: ${res.status} ${res.statusText} ${text}`);
    }
    const json = (await res.json()) as { sid?: string; status?: string };
    if (!json.sid) throw new Error('Twilio response missing sid');
    return { providerSid: json.sid, status: json.status ?? 'queued' };
  }
}
