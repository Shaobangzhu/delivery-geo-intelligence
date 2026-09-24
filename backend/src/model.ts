import { ObjectId } from "mongodb";
import { z } from "zod";

export const categorySchema = z.enum(["restaurant", "grocery", "retail", "other"]);
export type Category = z.infer<typeof categorySchema>;

export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Must be a 24-character hexadecimal ID");

export const pointSchema = z.strictObject({
  type: z.literal("Point"),
  coordinates: z.tuple([
    z.number().finite().min(-180).max(180),
    z.number().finite().min(-90).max(90)
  ])
});
export type GeoJsonPoint = z.infer<typeof pointSchema>;

export const merchantInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  category: categorySchema,
  publicAddress: z.string().trim().min(1).max(500),
  city: z.string().trim().min(1).max(120)
});
export const merchantPatchSchema = merchantInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one field is required" }
);

const timestampSchema = z.iso.datetime({ offset: true });

// This address is transient input only; it is never part of DeliveryDocument.
const destinationAddressSchema = z.string().trim().min(1).max(500);

export const deliveryInputSchema = z.strictObject({
  merchantId: objectIdSchema,
  pickedUpAt: timestampSchema,
  payout: z.number().finite().nonnegative().optional(),
  distanceMiles: z.number().finite().nonnegative().optional(),
  destinationAddress: destinationAddressSchema.optional(),
  notes: z.string().trim().max(2000).optional()
});

export const deliveryPatchSchema = z.strictObject({
  merchantId: objectIdSchema.optional(),
  pickedUpAt: timestampSchema.optional(),
  payout: z.number().finite().nonnegative().nullable().optional(),
  distanceMiles: z.number().finite().nonnegative().nullable().optional(),
  destinationAddress: destinationAddressSchema.optional(),
  notes: z.string().trim().max(2000).nullable().optional()
}).refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one field is required" }
);

export const deliveryQuerySchema = z.strictObject({
  search: z.string().trim().max(120).optional(),
  category: categorySchema.optional(),
  from: timestampSchema.optional(),
  to: timestampSchema.optional(),
  sort: z.enum(["newest", "oldest", "payoutDesc", "payoutAsc", "distanceDesc", "distanceAsc"]).default("newest"),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
}).refine(
  (value) => !value.from || !value.to || Date.parse(value.from) < Date.parse(value.to),
  { path: ["to"], message: "Must be later than from" }
);

export interface MerchantDocument {
  _id: ObjectId;
  name: string;
  category: Category;
  // Earlier merchant records can predate public-address capture.
  publicAddress?: string;
  location: GeoJsonPoint;
  city: string;
}

export interface DeliveryDocument {
  _id: ObjectId;
  merchantId: ObjectId;
  pickedUpAt: Date;
  payout?: number;
  distanceMiles?: number;
  destinationLocation?: GeoJsonPoint;
  notes?: string;
}

export function merchantResponse(merchant: MerchantDocument, deliveryCount: number) {
  return {
    id: merchant._id.toHexString(),
    name: merchant.name,
    category: merchant.category,
    ...(merchant.publicAddress === undefined ? {} : { publicAddress: merchant.publicAddress }),
    location: merchant.location,
    city: merchant.city,
    deliveryCount
  };
}

export function deliveryResponse(delivery: DeliveryDocument) {
  return {
    id: delivery._id.toHexString(),
    merchantId: delivery.merchantId.toHexString(),
    pickedUpAt: delivery.pickedUpAt.toISOString(),
    ...(delivery.payout === undefined ? {} : { payout: delivery.payout }),
    ...(delivery.distanceMiles === undefined ? {} : { distanceMiles: delivery.distanceMiles }),
    ...(delivery.notes === undefined ? {} : { notes: delivery.notes }),
    hasDestinationLocation: delivery.destinationLocation !== undefined
  };
}
