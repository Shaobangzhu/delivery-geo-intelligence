import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { Db } from "mongodb";
import { askSchema, createAnalyst, type Analyst } from "./agent.js";
import { createToolRegistry } from "./tools.js";
import { AnalystError, type ReadCoordinator } from "./types.js";

export function registerAiRoutes(app: Express, db: Db, coordinate: ReadCoordinator,
  analyst: Analyst = createAnalyst(null, "unconfigured")) {
  app.post("/api/ai/ask", async (request, response) => {
    const started = Date.now(), requestId = randomUUID(), input = askSchema.safeParse(request.body);
    response.setHeader("Cache-Control", "no-store");
    if (!input.success) {
      analyst.invalidQuestion(requestId, Date.now() - started);
      return response.status(400).json({ error: "Enter a question of 1–1000 characters.", code: "invalid_question", requestId });
    }
    const controller = new AbortController();
    const cancel = () => { if (!response.writableEnded) controller.abort(); };
    response.on("close", cancel);
    try { return response.json(await analyst(input.data.question, createToolRegistry(db, coordinate), requestId, controller.signal)); }
    catch (error) {
      const safe = error instanceof AnalystError ? error : new AnalystError("internal_failure", 503);
      if (!response.destroyed) return response.status(safe.status).json({ error: safe.message, code: safe.code, requestId });
    } finally { response.off("close", cancel); }
  });
}
