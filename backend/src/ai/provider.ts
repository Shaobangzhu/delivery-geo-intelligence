import OpenAI from "openai";
import { z } from "zod";
import type { ResponsesClient } from "./types.js";

export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
export function createResponsesClient(apiKey: string | undefined, model: string): ResponsesClient | null {
  if (!apiKey?.trim() || !z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/).safeParse(model).success) return null;
  const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 60_000 });
  return { create: (input, signal) => client.responses.create(input, { signal }) };
}
