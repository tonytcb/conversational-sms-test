export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidInboundEventError extends DomainError {}

export class NotFoundError extends DomainError {} // -> 404
