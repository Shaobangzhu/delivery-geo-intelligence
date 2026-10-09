import { MongoClient } from "mongodb";
import { createApp } from "./app.js";
import { DATABASE_NAME, ensureIndexes } from "./db.js";
import { env } from "./config/env.js";
import { createArcGisGeocoder, createArcGisStoredGeocoder } from "./geocoding.js";
import { createAnalyst } from "./ai/agent.js";
import { createResponsesClient, DEFAULT_OPENAI_MODEL } from "./ai/provider.js";

const client = new MongoClient(env.MONGODB_URI);

try {
  await client.connect();
  const db = client.db(DATABASE_NAME);
  await ensureIndexes(db);

  const geocodeDestination = createArcGisGeocoder(env.ARCGIS_GEOCODING_API_KEY, env.DESTINATION_COORDINATE_DECIMALS);
  const geocodeMerchant = createArcGisStoredGeocoder(env.ARCGIS_GEOCODING_API_KEY);
  const model = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const analyst = createAnalyst(createResponsesClient(env.OPENAI_API_KEY, model), model, (metadata) => {
    if (process.env.NODE_ENV === "development") console.info(JSON.stringify({ event: "dgi_ai_request", ...metadata }));
  });
  const server = createApp(db, geocodeDestination, geocodeMerchant, analyst).listen(env.PORT, "127.0.0.1", () => {
    console.info(`DGI API listening on http://127.0.0.1:${env.PORT}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      server.close(() => {
        void client.close().then(() => process.exit(0));
      });
    });
  }
} catch {
  console.error("DGI API could not connect to MongoDB or initialize indexes.");
  await client.close();
  process.exitCode = 1;
}
