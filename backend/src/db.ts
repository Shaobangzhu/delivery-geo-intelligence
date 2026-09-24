import type { Db } from "mongodb";
import type { DeliveryDocument, MerchantDocument } from "./model.js";

export const DATABASE_NAME = "delivery_geo_intelligence";

export async function ensureIndexes(db: Db): Promise<void> {
  const merchants = db.collection<MerchantDocument>("merchants");
  const deliveries = db.collection<DeliveryDocument>("deliveries");

  await Promise.all([
    merchants.createIndex({ location: "2dsphere" }),
    deliveries.createIndex({ destinationLocation: "2dsphere" }),
    deliveries.createIndex({ pickedUpAt: -1, _id: -1 }),
    deliveries.createIndex({ merchantId: 1, pickedUpAt: -1 })
  ]);
}
