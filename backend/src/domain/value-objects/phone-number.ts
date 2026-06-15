import { InvalidInboundEventError } from '../errors';

// E.164 value object
const E164 = /^\+[1-9]\d{1,14}$/;

export class PhoneNumber {
  private constructor(public readonly value: string) {}

  static parse(raw: string): PhoneNumber {
    const trimmed = (raw ?? '').trim();
    if (!E164.test(trimmed)) {
      throw new InvalidInboundEventError(`Invalid E.164 phone number: ${JSON.stringify(raw)}`);
    }
    return new PhoneNumber(trimmed);
  }
}
