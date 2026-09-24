import { MongoClient } from "mongodb";
import { createApp } from "./app.js";
import { DATABASE_NAME, ensureIndexes } from "./db.js";
import { env } from "./config/env.js";
import { createArcGisGeocoder } from "./geocoding.js";

const client = new MongoClient(env.MONGODB_URI);

try {
  await client.connect();
  const db = client.db(DATABASE_NAME);
  await ensureIndexes(db);

  const geocodeDestination = createArcGisGeocoder(env.ARCGIS_GEOCODING_API_KEY, env.DESTINATION_COORDINATE_DECIMALS);
  const server = createApp(db, geocodeDestination).listen(env.PORT, "127.0.0.1", () => {
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
