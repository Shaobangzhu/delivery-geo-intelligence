import express from "express";
import { env } from "./config/env.js";

const app = express();

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.listen(env.PORT, "127.0.0.1", () => {
  console.info(`DGI API listening on http://127.0.0.1:${env.PORT}`);
});
