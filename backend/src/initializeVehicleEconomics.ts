import { MongoClient } from "mongodb";
import { env } from "./config/env.js";
import { DATABASE_NAME } from "./db.js";
import { initializeVehicleEconomics } from "./vehicleEconomics.js";

const client = new MongoClient(env.MONGODB_URI);
try {
  await client.connect();
  await initializeVehicleEconomics(client.db(DATABASE_NAME));
  console.info("A.1 confirmed vehicle and annual mileage records initialized; existing records preserved.");
} catch {
  console.error("Could not initialize A.1 vehicle and annual mileage records.");
  process.exitCode = 1;
} finally {
  await client.close();
}
