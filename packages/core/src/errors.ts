import type { z } from 'zod';

export class Cardano402Error extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'Cardano402Error';
    if (options?.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export class Cardano402DecodeError extends Cardano402Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'Cardano402DecodeError';
  }
}

export class Cardano402ValidationError extends Cardano402Error {
  readonly issues: z.core.$ZodIssue[];

  constructor(
    message: string,
    issues: z.core.$ZodIssue[],
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'Cardano402ValidationError';
    this.issues = issues;
  }
}

export class Cardano402HttpError extends Cardano402Error {
  readonly status: number;
  readonly statusText: string;
  readonly body?: unknown;

  constructor(
    status: number,
    statusText: string,
    body?: unknown,
    options?: { cause?: unknown }
  ) {
    super(`Facilitator HTTP ${status} ${statusText}`, options);
    this.name = 'Cardano402HttpError';
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export class Cardano402NetworkError extends Cardano402Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'Cardano402NetworkError';
  }
}
