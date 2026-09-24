import express, { type NextFunction, type Request, type Response } from "express";
import { ObjectId, type Db, type Filter, type Sort } from "mongodb";
import { ZodError } from "zod";
import { GeocodingError, type DestinationGeocoder, type MerchantGeocoder } from "./geocoding.js";
import { dashboardFilterSchema, getDashboardAnalytics, getDestinationHeatmap } from "./dashboard.js";
import {
  deliveryInputSchema, deliveryPatchSchema, deliveryQuerySchema, deliveryResponse,
  merchantInputSchema, merchantPatchSchema, merchantResponse, objectIdSchema,
  type DeliveryDocument, type MerchantDocument
} from "./model.js";

function invalid(response: Response, error: ZodError) {
  return response.status(400).json({
    error: "Invalid request",
    details: error.issues.map((issue) => ({ field: issue.path.join(".") || "request", message: issue.message }))
  });
}

function geocodingFailure(response: Response, error: GeocodingError, subject: "Destination" | "Merchant" = "Destination") {
  const status = error.code === "no_match" || error.code === "low_confidence" ? 422
    : error.code === "network_error" ? 503 : 502;
  return response.status(status).json({ error: `${subject} geocoding failed`, code: error.code });
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const sorts: Record<string, Sort> = {
  newest: { pickedUpAt: -1, _id: -1 },
  oldest: { pickedUpAt: 1, _id: 1 },
  payoutDesc: { payout: -1, _id: -1 },
  payoutAsc: { payout: 1, _id: 1 },
  distanceDesc: { distanceMiles: -1, _id: -1 },
  distanceAsc: { distanceMiles: 1, _id: 1 }
};

export function createApp(db: Db, geocodeDestination: DestinationGeocoder, geocodeMerchant: MerchantGeocoder) {
  const app = express();
  const merchants = db.collection<MerchantDocument>("merchants");
  const deliveries = db.collection<DeliveryDocument>("deliveries");
  app.use(express.json({ limit: "32kb" }));

  app.get("/api/health", async (_request, response) => {
    try {
      await db.command({ ping: 1 });
      response.json({ status: "ok" });
    } catch {
      response.status(503).json({ status: "unavailable" });
    }
  });

  app.get("/api/dashboard", async (request, response) => {
    const parsed = dashboardFilterSchema.safeParse(request.query);
    if (!parsed.success) return invalid(response, parsed.error);
    return response.json(await getDashboardAnalytics(db, parsed.data));
  });

  app.get("/api/dashboard/destination-heatmap", async (request, response) => {
    const parsed = dashboardFilterSchema.safeParse(request.query);
    if (!parsed.success) return invalid(response, parsed.error);
    return response.json(await getDestinationHeatmap(db, parsed.data));
  });

  app.get("/api/merchants", async (_request, response) => {
    const rows = await merchants.find().sort({ name: 1, _id: 1 }).toArray();
    const counts = await deliveries.aggregate<{ _id: ObjectId; count: number }>([
      { $match: { merchantId: { $in: rows.map((merchant) => merchant._id) } } },
      { $group: { _id: "$merchantId", count: { $sum: 1 } } }
    ]).toArray();
    const countById = new Map(counts.map((row) => [row._id.toHexString(), row.count]));
    response.json({ data: rows.map((merchant) => merchantResponse(merchant, countById.get(merchant._id.toHexString()) ?? 0)) });
  });

  app.get("/api/merchants/:id", async (request, response) => {
    const parsed = objectIdSchema.safeParse(request.params.id);
    if (!parsed.success) return invalid(response, parsed.error);
    const id = new ObjectId(parsed.data);
    const merchant = await merchants.findOne({ _id: id });
    if (!merchant) return response.status(404).json({ error: "Merchant not found" });
    const deliveryCount = await deliveries.countDocuments({ merchantId: id });
    return response.json({ data: merchantResponse(merchant, deliveryCount) });
  });

  app.post("/api/merchants", async (request, response) => {
    const parsed = merchantInputSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response, parsed.error);
    let location: MerchantDocument["location"];
    try {
      location = await geocodeMerchant(parsed.data.publicAddress);
    } catch (error) {
      if (error instanceof GeocodingError) return geocodingFailure(response, error, "Merchant");
      throw error;
    }
    const merchant: MerchantDocument = { _id: new ObjectId(), ...parsed.data, location };
    await merchants.insertOne(merchant);
    return response.status(201).json({ data: merchantResponse(merchant, 0) });
  });

  app.patch("/api/merchants/:id", async (request, response) => {
    const id = objectIdSchema.safeParse(request.params.id);
    if (!id.success) return invalid(response, id.error);
    const parsed = merchantPatchSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response, parsed.error);
    const objectId = new ObjectId(id.data);
    const existing = await merchants.findOne({ _id: objectId });
    if (!existing) return response.status(404).json({ error: "Merchant not found" });
    const changes = parsed.data;
    const set: Partial<MerchantDocument> = { ...changes };
    if (changes.publicAddress !== undefined && changes.publicAddress !== existing.publicAddress) {
      try {
        set.location = await geocodeMerchant(changes.publicAddress);
      } catch (error) {
        if (error instanceof GeocodingError) return geocodingFailure(response, error, "Merchant");
        throw error;
      }
    }
    const updated = await merchants.findOneAndUpdate({ _id: objectId }, { $set: set }, { returnDocument: "after" });
    if (!updated) return response.status(404).json({ error: "Merchant not found" });
    const deliveryCount = await deliveries.countDocuments({ merchantId: objectId });
    return response.json({ data: merchantResponse(updated, deliveryCount) });
  });

  app.delete("/api/merchants/:id", async (request, response) => {
    const parsed = objectIdSchema.safeParse(request.params.id);
    if (!parsed.success) return invalid(response, parsed.error);
    const id = new ObjectId(parsed.data);
    if (!(await merchants.findOne({ _id: id }, { projection: { _id: 1 } }))) {
      return response.status(404).json({ error: "Merchant not found" });
    }
    if (await deliveries.countDocuments({ merchantId: id })) {
      return response.status(409).json({ error: "Merchant has delivery history and cannot be deleted" });
    }
    await merchants.deleteOne({ _id: id });
    return response.status(204).end();
  });

  app.get("/api/deliveries", async (request, response) => {
    const parsed = deliveryQuerySchema.safeParse(request.query);
    if (!parsed.success) return invalid(response, parsed.error);
    const { search, category, from, to, sort, page, pageSize } = parsed.data;
    const filter: Filter<DeliveryDocument> = {};
    if (search || category) {
      const merchantFilter: Filter<MerchantDocument> = {};
      if (search) merchantFilter.name = { $regex: escapeRegex(search), $options: "i" };
      if (category) merchantFilter.category = category;
      const matches = await merchants.find(merchantFilter, { projection: { _id: 1 } }).toArray();
      filter.merchantId = { $in: matches.map((merchant) => merchant._id) };
    }
    if (from || to) {
      filter.pickedUpAt = {
        ...(from ? { $gte: new Date(from) } : {}),
        ...(to ? { $lt: new Date(to) } : {})
      };
    }
    const [total, rows] = await Promise.all([
      deliveries.countDocuments(filter),
      deliveries.find(filter).sort(sorts[sort]).skip((page - 1) * pageSize).limit(pageSize).toArray()
    ]);
    return response.json({ data: rows.map(deliveryResponse), pagination: {
      page, pageSize, total, totalPages: Math.ceil(total / pageSize)
    } });
  });

  app.get("/api/deliveries/:id", async (request, response) => {
    const parsed = objectIdSchema.safeParse(request.params.id);
    if (!parsed.success) return invalid(response, parsed.error);
    const delivery = await deliveries.findOne({ _id: new ObjectId(parsed.data) });
    if (!delivery) return response.status(404).json({ error: "Delivery not found" });
    return response.json({ data: deliveryResponse(delivery) });
  });

  app.post("/api/deliveries", async (request, response) => {
    const parsed = deliveryInputSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response, parsed.error);
    const merchantId = new ObjectId(parsed.data.merchantId);
    if (!(await merchants.findOne({ _id: merchantId }, { projection: { _id: 1 } }))) {
      return response.status(422).json({ error: "Merchant not found" });
    }
    let destinationLocation: DeliveryDocument["destinationLocation"];
    if (parsed.data.destinationAddress !== undefined) {
      try {
        destinationLocation = await geocodeDestination(parsed.data.destinationAddress);
      } catch (error) {
        if (error instanceof GeocodingError) return geocodingFailure(response, error);
        throw error;
      }
    }
    const delivery: DeliveryDocument = {
      _id: new ObjectId(), merchantId, pickedUpAt: new Date(parsed.data.pickedUpAt),
      ...(parsed.data.payout === undefined ? {} : { payout: parsed.data.payout }),
      ...(parsed.data.distanceMiles === undefined ? {} : { distanceMiles: parsed.data.distanceMiles }),
      ...(destinationLocation === undefined ? {} : { destinationLocation }),
      ...(parsed.data.notes === undefined ? {} : { notes: parsed.data.notes })
    };
    await deliveries.insertOne(delivery);
    return response.status(201).json({ data: deliveryResponse(delivery) });
  });

  app.patch("/api/deliveries/:id", async (request, response) => {
    const id = objectIdSchema.safeParse(request.params.id);
    if (!id.success) return invalid(response, id.error);
    const parsed = deliveryPatchSchema.safeParse(request.body);
    if (!parsed.success) return invalid(response, parsed.error);
    const changes = parsed.data;
    if (!(await deliveries.findOne({ _id: new ObjectId(id.data) }, { projection: { _id: 1 } }))) {
      return response.status(404).json({ error: "Delivery not found" });
    }
    if (changes.merchantId && !(await merchants.findOne({ _id: new ObjectId(changes.merchantId) }, { projection: { _id: 1 } }))) {
      return response.status(422).json({ error: "Merchant not found" });
    }
    const set: Partial<DeliveryDocument> = {};
    const unset: Record<string, ""> = {};
    if (changes.merchantId !== undefined) set.merchantId = new ObjectId(changes.merchantId);
    if (changes.pickedUpAt !== undefined) set.pickedUpAt = new Date(changes.pickedUpAt);
    if (changes.destinationAddress !== undefined) {
      try {
        set.destinationLocation = await geocodeDestination(changes.destinationAddress);
      } catch (error) {
        if (error instanceof GeocodingError) return geocodingFailure(response, error);
        throw error;
      }
    }
    for (const field of ["payout", "distanceMiles", "notes"] as const) {
      const value = changes[field];
      if (value === null) unset[field] = "";
      else if (value !== undefined) Object.assign(set, { [field]: value });
    }
    const updated = await deliveries.findOneAndUpdate(
      { _id: new ObjectId(id.data) },
      { ...(Object.keys(set).length ? { $set: set } : {}), ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { returnDocument: "after" }
    );
    if (!updated) return response.status(404).json({ error: "Delivery not found" });
    return response.json({ data: deliveryResponse(updated) });
  });

  app.delete("/api/deliveries/:id", async (request, response) => {
    const parsed = objectIdSchema.safeParse(request.params.id);
    if (!parsed.success) return invalid(response, parsed.error);
    const result = await deliveries.deleteOne({ _id: new ObjectId(parsed.data) });
    if (!result.deletedCount) return response.status(404).json({ error: "Delivery not found" });
    return response.status(204).end();
  });

  // Do not echo request contents or driver errors, which could contain private data.
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status = typeof error === "object" && error !== null && "status" in error ? error.status : undefined;
    if (status === 400) return response.status(400).json({ error: "Invalid JSON body" });
    if (status === 413) return response.status(413).json({ error: "Request body too large" });
    return response.status(500).json({ error: "Internal server error" });
  });
  return app;
}
