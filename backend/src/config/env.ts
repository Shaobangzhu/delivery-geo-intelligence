import "dotenv/config";
import { z } from "zod";

const environmentSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  MONGODB_URI: z.string().regex(/^mongodb(?:\+srv)?:\/\//, "Must be a MongoDB URI"),
  ARCGIS_GEOCODING_API_KEY: z.string().trim().min(1),
  DESTINATION_COORDINATE_DECIMALS: z.coerce.number().int().min(0).max(2).default(2)
});

const result = environmentSchema.safeParse(process.env);
if (!result.success) {
  const names = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new Error(`Invalid backend environment configuration: ${names}`);
}

export const env = result.data;
