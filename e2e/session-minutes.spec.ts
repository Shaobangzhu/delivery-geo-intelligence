import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

// Exercise the fixed LA interpretation independently of the browser timezone.
test.use({ timezoneId: "UTC" });

// Playwright's ARIA snapshot collapses datetime inputs to a single textbox.
// Chromium's full accessibility tree exposes the actual native editor fields.
async function expectMinuteEditors(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = await cdp.send("Accessibility.getFullAXTree");
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    for (const label of ["Session Start *", "Session End *"]) {
      const input = page.getByLabel(label, { exact: true });
      await expect(input).toHaveAttribute("type", "datetime-local");
      await expect(input).toHaveAttribute("step", "60");
      const control = nodes.find((node) => node.role?.value === "DateTime" && node.name?.value === label);
      expect(control, `Native ${label} editor`).toBeTruthy();
      const fields = nodes.filter((node) => {
        if (node.role?.value !== "spinbutton") return false;
        let parent = node.parentId;
        while (parent) {
          if (parent === control!.nodeId) return true;
          parent = byId.get(parent)?.parentId;
        }
        return false;
      }).map((node) => node.name?.value);
      expect(fields).toHaveLength(6);
      for (const name of ["Month", "Day", "Year", "Hours", "Minutes", "AM/PM"]) {
        expect(fields.some((field) => field?.startsWith(name))).toBeTruthy();
      }
      expect(fields.join(" ")).not.toMatch(/seconds/i);
    }
  } finally { await cdp.detach(); }
}

for (const [name, start, end, startIso, endIso, duration] of [
  ["midnight and noon", "2026-01-15T00:00", "2026-01-15T12:00", "2026-01-15T08:00:00.000Z", "2026-01-15T20:00:00.000Z", 43200],
  ["AM and PM in summer", "2026-07-15T11:34", "2026-07-15T23:59", "2026-07-15T18:34:00.000Z", "2026-07-16T06:59:00.000Z", 44700],
  ["spring DST", "2026-03-07T23:30", "2026-03-08T03:30", "2026-03-08T07:30:00.000Z", "2026-03-08T10:30:00.000Z", 10800]
] as const) {
  test(`History: minute-only Add/Edit round trip for ${name}`, async ({ page, request }, testInfo) => {
    await page.goto("/history");
    await page.getByRole("button", { name: /Add Session$/ }).click();
    await expectMinuteEditors(page);
    await page.getByRole("button", { name: "Save Session", exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText("end after start");
    await page.getByLabel("Session Start *", { exact: true }).fill(start);
    await page.getByLabel("Session End *", { exact: true }).fill(end);
    await expectMinuteEditors(page);
    await page.getByRole("button", { name: "Save Session", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const { data: [saved] } = await (await request.get("/api/delivery-sessions")).json();
    expect(saved).toMatchObject({ startedAt: startIso, endedAt: endIso, sessionDurationSeconds: duration, deliveryIds: [] });
    await page.reload();
    await page.getByRole("button", { name: `Edit session ${saved.id.slice(-6)}`, exact: true }).click();
    await expect(page.getByLabel("Session Start *", { exact: true })).toHaveValue(start);
    await expect(page.getByLabel("Session End *", { exact: true })).toHaveValue(end);
    await expectMinuteEditors(page);
    await testInfo.attach("minute-only-edit-modal", { body: await page.getByRole("dialog").screenshot(), contentType: "image/png" });
    // An explicitly edited timestamp persists its local minute with zero seconds/millis.
    const changedEnd = `${end.slice(0, 14)}58`;
    await page.getByLabel("Session End *", { exact: true }).fill(changedEnd);
    await page.getByRole("button", { name: "Save Session", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const { data: updated } = await (await request.get(`/api/delivery-sessions/${saved.id}`)).json();
    expect(updated.startedAt).toBe(startIso);
    expect(updated.endedAt).toBe(`${endIso.slice(0, 14)}58:00.000Z`);
    await page.getByRole("button", { name: `Edit session ${saved.id.slice(-6)}`, exact: true }).click();
    await expect(page.getByLabel("Session End *", { exact: true })).toHaveValue(changedEnd);
  });
}

test("History: minute edits preserve fall DST occurrence, delivery facts, links, calculations, and pagination", async ({ page, request }) => {
  const deliveries = (await (await request.get("/api/deliveries")).json()).data;
  const created = await request.post("/api/delivery-sessions", { data: {
    startedAt: "2026-11-01T09:30:42.123Z", endedAt: "2026-11-01T10:30:59.456Z",
    strategy: "eastvale_local_only", totalDrivenMiles: 8.4, taxEligibleBusinessMiles: 5,
    tripsOfferedByPlatform: { uber_eats: 3, doordash: 2 }, deliveryIds: [deliveries[0].id]
  } });
  expect(created.ok()).toBeTruthy();
  const { data: original } = await created.json();
  const linkedFacts = (await (await request.get("/api/deliveries")).json()).data;
  for (let i = 0; i < 10; i++) {
    expect((await request.post("/api/delivery-sessions", { data: { startedAt: "2026-11-02T18:00:00Z", endedAt: "2026-11-02T19:00:00Z" } })).ok()).toBeTruthy();
  }
  await page.goto("/history");
  const pagination = page.getByRole("navigation", { name: "Delivery session pages" });
  await pagination.getByRole("button", { name: "Next page", exact: true }).click();
  const edit = page.getByRole("button", { name: `Edit session ${original.id.slice(-6)}`, exact: true });
  await edit.click();
  await expect(page.getByLabel("Session Start *", { exact: true })).toHaveValue("2026-11-01T01:30");
  await expect(page.getByLabel("Session End *", { exact: true })).toHaveValue("2026-11-01T02:30");
  await expect(page.getByLabel("Start clock occurrence", { exact: true })).toHaveValue("later");
  await expectMinuteEditors(page);
  // Opening and canceling cannot write timestamps or affect analytics.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await (await request.get(`/api/delivery-sessions/${original.id}`)).json()).data).toEqual(original);
  await edit.click();
  await page.getByRole("button", { name: "Save Session", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await (await request.get(`/api/delivery-sessions/${original.id}`)).json()).data).toEqual(original);
  await edit.click();
  await page.getByLabel("Session Start *", { exact: true }).fill("2026-11-01T01:31");
  await page.getByLabel("Session End *", { exact: true }).fill("2026-11-01T02:31");
  await page.getByRole("button", { name: "Save Session", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const { data: updated } = await (await request.get(`/api/delivery-sessions/${original.id}`)).json();
  expect(updated).toEqual({ ...original, startedAt: "2026-11-01T09:31:00.000Z", endedAt: "2026-11-01T10:31:00.000Z", sessionDurationSeconds: 3600 });
  expect((await (await request.get("/api/deliveries")).json()).data).toEqual(linkedFacts);
  await expect(pagination.getByRole("button", { name: "Page 2", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Showing 1–3 of 3 deliveries")).toBeVisible();
  await edit.click();
  await page.getByLabel("Session End *", { exact: true }).fill("2026-11-01T01:00");
  await page.getByRole("button", { name: "Save Session", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("end after start");
  await page.getByLabel("Session Start *", { exact: true }).fill("2026-03-08T02:30");
  await page.getByLabel("Session End *", { exact: true }).fill("2026-03-08T03:30");
  await page.getByRole("button", { name: "Save Session", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText("Skipped DST clock times are invalid");
  expect((await (await request.get(`/api/delivery-sessions/${original.id}`)).json()).data).toEqual(updated);
});
