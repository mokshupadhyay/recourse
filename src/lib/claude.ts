import Anthropic from "@anthropic-ai/sdk";
import { AppError } from "./errors";

// Created on first use so pages that never call Claude still load without a key.
// Reads ANTHROPIC_API_KEY (or an `ant auth login` profile) from the environment.
let client: Anthropic | null = null;
export const claude = () => (client ??= new Anthropic());

export const MODEL = process.env.RECOURSE_MODEL ?? "claude-opus-5-5";

// If the model's safety classifiers decline a request, let the API re-run it on its
// default fallback model instead of failing the purchase or the dispute review.
export const FALLBACK: { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: "default" } = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default",
};

export function describeError(error: unknown): string {
  if (error instanceof AppError) return error.message;
  if (error instanceof Anthropic.AuthenticationError) {
    return "Claude API key is invalid. Check ANTHROPIC_API_KEY in .env.local.";
  }
  if (error instanceof Anthropic.RateLimitError) return "Claude API rate limit reached. Try again shortly.";
  if (error instanceof Anthropic.APIError) return `Claude API error ${error.status}: ${error.message}`;
  const detail = error instanceof Error ? error.message : String(error);
  // The SDK throws a plain Error before any request when it finds no credentials.
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return `Claude API key is missing: set ANTHROPIC_API_KEY in .env.local, or use the demo terms and the simulated agent. (${detail})`;
  }
  return detail;
}
