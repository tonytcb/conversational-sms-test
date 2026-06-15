#!/usr/bin/env node
// Fake an inbound Twilio SMS.
// Usage: node scripts/send-sms.mjs <from> <to> <body>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// tiny .env reader
function loadEnv() {
  const file = path.join(root, '.env');
  const env = { ...process.env };
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return env;
}

const env = loadEnv();
const hostPort = env.API_HOST_PORT || env.API_PORT || '3000';
const postUrl = process.env.SMS_POST_URL || `http://localhost:${hostPort}/webhooks/twilio/sms`;

const from = process.argv[2] || '+15551234567';
const to = process.argv[3] || env.TWILIO_FROM_NUMBER || '+15550000000';
const body = process.argv[4] || 'Hello from a customer';

const messageSid = 'SM' + crypto.randomBytes(16).toString('hex');

const params = { MessageSid: messageSid, From: from, To: to, Body: body };

const res = await fetch(postUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(params).toString(),
});

const text = await res.text();
console.log(`-> POST ${postUrl}`);
console.log(`   From=${from} To=${to} Body=${JSON.stringify(body)}`);
console.log(`   MessageSid=${messageSid}`);
console.log(`<- ${res.status} ${res.statusText}`);
if (text.trim()) console.log(text.trim());
if (!res.ok) process.exit(1);
