import type {
  QuoteRequest,
  SourceCapabilities,
  SourceHealth,
  SourceQuoteResult,
} from "@/lib/domain/types";

export interface QuoteSource {
  id: string;
  getQuotes(request: QuoteRequest): Promise<SourceQuoteResult>;
  healthCheck(): Promise<SourceHealth>;
  capabilities(): SourceCapabilities;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}
