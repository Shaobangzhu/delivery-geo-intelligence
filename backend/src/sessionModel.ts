import { ObjectId } from "mongodb";
import { z } from "zod";
import { objectIdSchema } from "./model.js";

export const strategySchema = z.enum(["wide_area_marathon", "home_based_multi_order", "eastvale_local_only", "other"]);
const milesSchema = z.number().finite().nonnegative();
const instantSchema = z.iso.datetime({ offset: true }).refine((value) => Number.isFinite(Date.parse(value)), "Invalid instant");
const fields = {
  startedAt: instantSchema,
  endedAt: instantSchema,
  strategy: strategySchema.optional(),
  totalDrivenMiles: milesSchema.optional(),
  taxEligibleBusinessMiles: milesSchema.optional(),
  notes: z.string().trim().max(2000).optional()
};
export const sessionInputSchema = z.strictObject(fields)
  .refine((value) => Date.parse(value.endedAt) > Date.parse(value.startedAt), { path: ["endedAt"], message: "Must be later than session start" })
  .refine((value) => value.totalDrivenMiles === undefined || value.taxEligibleBusinessMiles === undefined || value.taxEligibleBusinessMiles <= value.totalDrivenMiles,
    { path: ["taxEligibleBusinessMiles"], message: "Cannot exceed total driven miles" });
const deliveryIdsSchema = z.array(objectIdSchema).max(500).refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, "Delivery IDs must be distinct");
export const sessionCreateSchema = sessionInputSchema.safeExtend({ deliveryIds: deliveryIdsSchema.optional() });
export const sessionPatchSchema = z.strictObject({
  startedAt: instantSchema.optional(), endedAt: instantSchema.optional(),
  strategy: strategySchema.nullable().optional(),
  totalDrivenMiles: milesSchema.nullable().optional(),
  taxEligibleBusinessMiles: milesSchema.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  deliveryIds: deliveryIdsSchema.optional()
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");
export interface DeliverySessionDocument {
  _id: ObjectId;
  startedAt: Date;
  endedAt: Date;
  strategy?: z.infer<typeof strategySchema>;
  totalDrivenMiles?: number;
  taxEligibleBusinessMiles?: number;
  notes?: string;
}
export function sessionFieldsResponse({ _id, startedAt, endedAt, ...fields }: DeliverySessionDocument) {
  return { id: _id.toHexString(), startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(),
    sessionDurationSeconds: (endedAt.getTime() - startedAt.getTime()) / 1000, ...fields };
}

const costSchema = z.number().finite().nonnegative();
const profileFields = {
  vehicleName: z.literal("2022 Tesla Model Y Long Range"),
  energyCashCostPerMile: costSchema,
  tireReplacementSetCost: costSchema,
  expectedTireSetLifeMiles: z.number().finite().positive().optional(),
  marginalDepreciationCostPerMile: costSchema.optional()
};
export const vehicleProfileSchema = z.strictObject(profileFields).refine(
  (value) => value.expectedTireSetLifeMiles === undefined || Number.isFinite(value.tireReplacementSetCost / value.expectedTireSetLifeMiles),
  { path: ["expectedTireSetLifeMiles"], message: "Tire life must produce a finite rate" }
);
export const vehicleProfilePatchSchema = z.strictObject({
  energyCashCostPerMile: costSchema.optional(), tireReplacementSetCost: costSchema.optional(),
  expectedTireSetLifeMiles: profileFields.expectedTireSetLifeMiles.unwrap().nullable().optional(),
  marginalDepreciationCostPerMile: costSchema.nullable().optional()
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");
export type VehicleEconomicsProfile = z.infer<typeof vehicleProfileSchema>;
export type VehicleProfileDocument = VehicleEconomicsProfile & { _id: "primary" };

export const taxYearSchema = z.coerce.number().int().min(2000).max(2100);
export const annualMileageSchema = z.strictObject({
  totalVehicleMiles: milesSchema, uberEatsBusinessMiles: milesSchema,
  realtorBusinessMiles: milesSchema.optional(), otherBusinessMiles: milesSchema.optional(),
  taxMethod: z.literal("standard_mileage")
}).refine((value) => value.uberEatsBusinessMiles + (value.realtorBusinessMiles ?? 0) + (value.otherBusinessMiles ?? 0) <= value.totalVehicleMiles,
  { path: ["totalVehicleMiles"], message: "Known business miles cannot exceed annual vehicle miles" });
export type VehicleTaxYearRecord = z.infer<typeof annualMileageSchema> & { taxYear: number };
export type VehicleTaxYearDocument = VehicleTaxYearRecord & { _id: number };
