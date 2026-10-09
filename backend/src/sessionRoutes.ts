import type { Express, Response } from "express";
import { ObjectId, type Db } from "mongodb";
import type { ZodError } from "zod";
import { objectIdSchema, type DeliveryDocument } from "./model.js";
import {
  sessionCreateSchema, sessionInputSchema, sessionPatchSchema, sessionFieldsResponse,
  vehicleProfileSchema, vehicleProfilePatchSchema, annualMileageSchema, taxYearSchema,
  type DeliverySessionDocument, type VehicleProfileDocument, type VehicleTaxYearDocument
} from "./sessionModel.js";
import { calculateVehicleCost, initializeVehicleEconomics, vehicleEconomicsResponse, annualMileageResponse } from "./vehicleEconomics.js";

type ReferenceWrite = <T>(operation: () => Promise<T>) => Promise<T>;
export function registerSessionRoutes(app: Express, db: Db, withReferenceWrite: ReferenceWrite,
  invalid: (response: Response, error: ZodError) => Response) {
  const sessions = db.collection<DeliverySessionDocument>("deliverySessions");
  const deliveries = db.collection<DeliveryDocument>("deliveries");
  const profiles = db.collection<VehicleProfileDocument>("vehicleEconomics");

  async function responses(rows: DeliverySessionDocument[]) {
    const profile = await profiles.findOne({ _id: "primary" });
    const links = await deliveries.find({ sessionId: { $in: rows.map((row) => row._id) } },
      { projection: { _id: 1, sessionId: 1, merchantId: 1, pickedUpAt: 1 } }).toArray();
    return rows.map((row) => {
      const linked = links.filter((delivery) => delivery.sessionId?.equals(row._id));
      return { ...sessionFieldsResponse(row), deliveryIds: linked.map((delivery) => delivery._id.toHexString()),
        linkedDeliveries: linked.map((delivery) => ({ id: delivery._id.toHexString(), merchantId: delivery.merchantId.toHexString(), pickedUpAt: delivery.pickedUpAt.toISOString() })),
        vehicleCost: calculateVehicleCost(profile, row.totalDrivenMiles) };
    });
  }
  async function checkLinks(ids: ObjectId[], sessionId: ObjectId): Promise<"missing" | "conflict" | null> {
    if (await deliveries.countDocuments({ _id: { $in: ids } }) !== ids.length) return "missing";
    if (await deliveries.countDocuments({ _id: { $in: ids }, sessionId: { $exists: true, $ne: sessionId } })) return "conflict";
    return null;
  }
  function linkError(response: Response, error: "missing" | "conflict") {
    return response.status(error === "missing" ? 422 : 409).json({ error: error === "missing" ? "Selected delivery is unavailable" : "Selected delivery already belongs to another session" });
  }
  async function replaceLinks(id: ObjectId, ids: ObjectId[]) {
    await deliveries.updateMany({ sessionId: id, _id: { $nin: ids } }, { $unset: { sessionId: "" } });
    if (ids.length) await deliveries.updateMany({ _id: { $in: ids } }, { $set: { sessionId: id } });
  }
  async function linkedIds(id: ObjectId) {
    return (await deliveries.find({ sessionId: id }, { projection: { _id: 1 } }).toArray()).map((row) => row._id);
  }
  // Standalone MongoDB has no multi-document transaction. Mark before mutating,
  // compensate recoverable failures, and leave the marker if recovery fails.
  async function changeSession(before: DeliverySessionDocument | null, after: DeliverySessionDocument | null, ids?: ObjectId[]) {
    const id = (before ?? after)!._id;
    const previousLinks = await linkedIds(id);
    try {
      if (before) await sessions.updateOne({ _id: id }, { $set: { associationIntegrity: "pending" } });
      else await sessions.insertOne({ ...after!, associationIntegrity: "pending" });
      if (after && before) await sessions.replaceOne({ _id: id }, { ...after, associationIntegrity: "pending" });
      if (ids !== undefined) await replaceLinks(id, ids);
      if (after) await sessions.updateOne({ _id: id }, { $unset: { associationIntegrity: "" } });
      else await sessions.deleteOne({ _id: id });
    } catch (error) {
      try {
        // Restore only Session fields and references; never rewrite Delivery facts.
        if (before) await sessions.replaceOne({ _id: id }, { ...before, associationIntegrity: "pending" }, { upsert: true });
        await replaceLinks(id, previousLinks);
        if (before && !before.associationIntegrity) await sessions.updateOne({ _id: id }, { $unset: { associationIntegrity: "" } });
        else if (!before) await sessions.deleteOne({ _id: id });
      } catch { /* The persisted marker prevents complete efficiency until reviewed. */ }
      throw error;
    }
  }
  app.get("/api/delivery-sessions", async (_request, response) => {
    return withReferenceWrite(async () => response.json({ data: await responses(await sessions.find().sort({ startedAt: -1, _id: -1 }).toArray()) }));
  });
  app.get("/api/delivery-sessions/:id", async (request, response) => {
    const parsed = objectIdSchema.safeParse(request.params.id);
    if (!parsed.success) return invalid(response, parsed.error);
    return withReferenceWrite(async () => {
      const row = await sessions.findOne({ _id: new ObjectId(parsed.data) });
      if (!row) return response.status(404).json({ error: "Session not found" });
      return response.json({ data: (await responses([row]))[0] });
    });
  });
  app.post("/api/delivery-sessions", async (request, response) => {
    const parsed = sessionCreateSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response, parsed.error);
    const { deliveryIds, startedAt, endedAt, ...fields } = parsed.data;
    const row: DeliverySessionDocument = { _id: new ObjectId(), startedAt: new Date(startedAt), endedAt: new Date(endedAt), ...fields };
    const ids = (deliveryIds ?? []).map((id) => new ObjectId(id));
    return withReferenceWrite(async () => {
      const error = await checkLinks(ids, row._id);
      if (error) return linkError(response, error);
      await changeSession(null, row, ids);
      return response.status(201).json({ data: (await responses([row]))[0] });
    });
  });
  app.patch("/api/delivery-sessions/:id", async (request, response) => {
    const id = objectIdSchema.safeParse(request.params.id);
    if (!id.success) return invalid(response, id.error);
    const patch = sessionPatchSchema.safeParse(request.body);
    if (!patch.success) return invalid(response, patch.error);
    const sessionId = new ObjectId(id.data);
    const outcome = await withReferenceWrite(async () => {
      const existing = await sessions.findOne({ _id: sessionId });
      if (!existing) return { kind: "missing" as const };
      const { _id, associationIntegrity, ...fields } = existing;
      const { deliveryIds, ...changes } = patch.data;
      if (associationIntegrity && deliveryIds === undefined) return { kind: "review" as const };
      const merged: Record<string, unknown> = { ...fields, startedAt: existing.startedAt.toISOString(), endedAt: existing.endedAt.toISOString(), ...changes };
      for (const [key, value] of Object.entries(merged)) if (value === null) delete merged[key];
      const validated = sessionInputSchema.safeParse(merged);
      if (!validated.success) return { kind: "invalid" as const, error: validated.error };
      const ids = deliveryIds?.map((id) => new ObjectId(id));
      if (ids) {
        const error = await checkLinks(ids, _id);
        if (error) return { kind: "links" as const, error };
      }
      const { startedAt, endedAt, ...observations } = validated.data;
      const updated = { _id, startedAt: new Date(startedAt), endedAt: new Date(endedAt), ...observations };
      await changeSession(existing, updated, ids);
      return { kind: "updated" as const, data: (await responses([updated]))[0] };
    });
    if (outcome.kind === "missing") return response.status(404).json({ error: "Session not found" });
    if (outcome.kind === "invalid") return invalid(response, outcome.error);
    if (outcome.kind === "links") return linkError(response, outcome.error);
    if (outcome.kind === "review") return response.status(409).json({ error: "Review and resubmit delivery associations before saving this session" });
    return response.json({ data: outcome.data });
  });
  app.delete("/api/delivery-sessions/:id", async (request, response) => {
    const parsed = objectIdSchema.safeParse(request.params.id);
    if (!parsed.success) return invalid(response, parsed.error);
    const id = new ObjectId(parsed.data);
    const deleted = await withReferenceWrite(async () => {
      const existing = await sessions.findOne({ _id: id });
      if (!existing) return false;
      await changeSession(existing, null, []);
      return true;
    });
    if (!deleted) return response.status(404).json({ error: "Session not found" });
    return response.status(204).end();
  });

  app.get("/api/vehicle-economics", async (_request, response) => response.json(await withReferenceWrite(() => vehicleEconomicsResponse(db))));
  app.post("/api/vehicle-economics/initialize", async (_request, response) => {
    await withReferenceWrite(() => initializeVehicleEconomics(db));
    return response.json(await vehicleEconomicsResponse(db));
  });
  app.patch("/api/vehicle-economics", async (request, response) => {
    const patch = vehicleProfilePatchSchema.safeParse(request.body);
    if (!patch.success) return invalid(response, patch.error);
    return withReferenceWrite(async () => {
      const existing = await profiles.findOne({ _id: "primary" });
      if (!existing) return response.status(404).json({ error: "Initialize vehicle settings first" });
      const { _id, ...fields } = existing;
      const merged: Record<string, unknown> = { ...fields, ...patch.data };
      for (const [key, value] of Object.entries(merged)) if (value === null) delete merged[key];
      const validated = vehicleProfileSchema.safeParse(merged);
      if (!validated.success) return invalid(response, validated.error);
      await profiles.replaceOne({ _id }, validated.data);
      return response.json(await vehicleEconomicsResponse(db));
    });
  });
  app.put("/api/vehicle-mileage/:taxYear", async (request, response) => {
    const year = taxYearSchema.safeParse(request.params.taxYear);
    if (!year.success) return invalid(response, year.error);
    const parsed = annualMileageSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response, parsed.error);
    const record: VehicleTaxYearDocument = { _id: year.data, taxYear: year.data, ...parsed.data };
    const result = await withReferenceWrite(() => db.collection<VehicleTaxYearDocument>("vehicleTaxYears").replaceOne({ _id: year.data }, { taxYear: year.data, ...parsed.data }, { upsert: true }));
    return response.status(result.upsertedCount ? 201 : 200).json({ data: annualMileageResponse(record) });
  });
}
