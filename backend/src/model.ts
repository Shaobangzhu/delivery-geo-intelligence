import { ObjectId } from "mongodb";
import { z } from "zod";

export const categorySchema = z.enum(["restaurant", "grocery", "retail", "other"]);
export type Category = z.infer<typeof categorySchema>;

export const deliveryPlatformSchema = z.enum(["uber_eats", "doordash"]);
export type DeliveryPlatform = z.infer<typeof deliveryPlatformSchema>;
// Unknown is a query choice only. Stored records have a known platform or no field.
export const platformFilterSchema = z.union([deliveryPlatformSchema, z.literal("unknown")]);
export const earningsAdjustmentQuerySchema = z.strictObject({ platform: platformFilterSchema.optional() });

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

const deliveryDurationSchema = z.number().finite().int().positive();

const timestampSchema = z.iso.datetime({ offset: true });

// This address is transient input only; it is never part of DeliveryDocument.
const destinationAddressSchema = z.string().trim().min(1).max(500);

export const deliveryInputSchema = z.strictObject({
  platform: deliveryPlatformSchema,
  merchantId: objectIdSchema,
  pickedUpAt: timestampSchema,
  payout: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER / 100).optional(),
  distanceMiles: z.number().finite().nonnegative().optional(),
  deliveryDurationSeconds: deliveryDurationSchema.optional(),
  destinationAddress: destinationAddressSchema.optional(),
  notes: z.string().trim().max(2000).optional()
});

export const deliveryPatchSchema = z.strictObject({
  platform: deliveryPlatformSchema.optional(),
  merchantId: objectIdSchema.optional(),
  pickedUpAt: timestampSchema.optional(),
  payout: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER / 100).nullable().optional(),
  distanceMiles: z.number().finite().nonnegative().nullable().optional(),
  deliveryDurationSeconds: deliveryDurationSchema.nullable().optional(),
  destinationAddress: destinationAddressSchema.optional(),
  notes: z.string().trim().max(2000).nullable().optional()
}).refine(
  (value) => Object.keys(value).length > 0,
  { message: "At least one field is required" }
);

export const deliveryQuerySchema = z.strictObject({
  platform: platformFilterSchema.optional(),
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
  platform?: DeliveryPlatform;
  merchantId: ObjectId;
  sessionId?: ObjectId;
  pickedUpAt: Date;
  payout?: number;
  distanceMiles?: number;
  deliveryDurationSeconds?: number;
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
    ...(delivery.platform === undefined ? {} : { platform: delivery.platform }),
    merchantId: delivery.merchantId.toHexString(),
    ...(delivery.sessionId === undefined ? {} : { sessionId: delivery.sessionId.toHexString() }),
    pickedUpAt: delivery.pickedUpAt.toISOString(),
    ...(delivery.payout === undefined ? {} : { payout: delivery.payout }),
    ...(delivery.distanceMiles === undefined ? {} : { distanceMiles: delivery.distanceMiles }),
    ...(delivery.deliveryDurationSeconds === undefined ? {} : { deliveryDurationSeconds: delivery.deliveryDurationSeconds }),
    ...(delivery.notes === undefined ? {} : { notes: delivery.notes }),
    hasDestinationLocation: delivery.destinationLocation !== undefined
  };
}

// Cent values must stay within integer arithmetic's exact range.
const settlementCurrencySchema = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER / 100).multipleOf(0.01);
export const settlementDetailsSchema = z.strictObject({
  engagedSeconds: z.number().finite().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  engagedMiles: z.number().finite().nonnegative().optional(),
  eligibleEarningsExcludingTips: settlementCurrencySchema.optional(),
  reportedGuaranteedAmount: settlementCurrencySchema.optional()
});
export type Prop22SettlementDetails = z.infer<typeof settlementDetailsSchema>;
const settlementDetailsPatchSchema = z.strictObject({
  engagedSeconds: settlementDetailsSchema.shape.engagedSeconds.unwrap().nullable().optional(),
  engagedMiles: settlementDetailsSchema.shape.engagedMiles.unwrap().nullable().optional(),
  eligibleEarningsExcludingTips: settlementCurrencySchema.nullable().optional(),
  reportedGuaranteedAmount: settlementCurrencySchema.nullable().optional()
}).refine((value) => Object.keys(value).length > 0, { message: "At least one settlement field is required" });

const adjustmentFields = {
  platform: deliveryPlatformSchema.optional(),
  type: z.literal("prop22_guarantee"),
  paymentDate: z.iso.date(),
  amount: settlementCurrencySchema.positive(),
  coverageStartDate: z.iso.date().optional(),
  coverageEndDate: z.iso.date().optional(),
  sessionCoverageConfirmed: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional(),
  settlementDetails: settlementDetailsSchema.optional()
};
// PATCH validates merged persisted data; legacy records need not gain a platform.
export const earningsAdjustmentPersistedSchema = z.strictObject(adjustmentFields).refine(
  (value) => (value.coverageStartDate === undefined && value.coverageEndDate === undefined) ||
    (value.coverageStartDate !== undefined && value.coverageEndDate !== undefined && value.coverageStartDate <= value.coverageEndDate),
  { path: ["coverageEndDate"], message: "Supply both coverage dates in chronological order" }
);
export const earningsAdjustmentInputSchema = earningsAdjustmentPersistedSchema.safeExtend({ platform: deliveryPlatformSchema });
export const earningsAdjustmentPatchSchema = z.strictObject({
  ...adjustmentFields,
  coverageStartDate: z.iso.date().nullable().optional(),
  coverageEndDate: z.iso.date().nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  settlementDetails: settlementDetailsPatchSchema.nullable().optional()
}).partial().refine((value) => Object.keys(value).length > 0, { message: "At least one field is required" });
export type EarningsAdjustmentDocument = z.infer<typeof earningsAdjustmentPersistedSchema> & { _id: ObjectId };
export function earningsAdjustmentResponse({ _id, ...fields }: EarningsAdjustmentDocument) {
  return { id: _id.toHexString(), ...fields };
}
