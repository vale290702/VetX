import { expect, test, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openClinicalChart } from "./support/clinical-chart.js";
test.use({ trace: "off" });
test.setTimeout(120_000);
async function fill(form: Locator, values: Record<string, string>) {
  for (const [field, value] of Object.entries(values))
    await form.locator('[name="' + field + '"]').fill(value);
}
async function act(entry: Locator, label: string, values: Record<string, string>) {
  const details = entry
    .locator("details")
    .filter({ has: entry.page().locator("summary").filter({ hasText: label }) });
  await details.locator("summary").click();
  await fill(details, values);
  await details.getByRole("button", { name: label, exact: true }).click();
}
test("staff advance hospital stays and surgery; owners see only released final summaries", async ({
  page,
  browser,
  request,
}) => {
  page.setDefaultTimeout(15_000);
  const { encounterId, ownerRecords, cleanup } = await openClinicalChart(page, browser, request);
  try {
    const create = page.getByRole("region", { name: "Add a clinical record" }),
      chart = page.getByRole("region", { name: "Current records" });
    await create.locator("summary").click();
    async function add(kind: string, values: Record<string, string>, action: string) {
      await create.getByRole("combobox", { name: "Record type" }).selectOption(kind);
      await create
        .getByRole("combobox", { name: "Encounter", exact: true })
        .selectOption(encounterId);
      await fill(create, { occurredAt: "2026-11-01T09:00", ...values });
      await create.getByRole("button", { name: action }).click();
    }
    const stay = chart
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: /^Hospital stay/ }) });
    await add(
      "hospitalization",
      { ward: "North ward", location: "Room 21", note: "Internal admission observation" },
      "Admit patient",
    );
    await expect(stay.getByRole("heading", { name: "Hospital stay · Admitted" })).toBeVisible();
    await expect(stay.getByText("Guardian access", { exact: true })).toHaveCount(0);
    await add("hospitalization", { ward: "Forbidden second stay", note: "Extra" }, "Admit patient");
    await expect(create.getByRole("alert")).toContainText("already has an active stay");
    await expect(stay).toHaveCount(1);
    const stale = await page.context().newPage();
    try {
      await stale.goto(page.url());
      const staleStay = stale
        .getByRole("listitem")
        .filter({ has: stale.getByRole("heading", { name: "Hospital stay · Admitted" }) });
      await staleStay.locator("summary").filter({ hasText: "Record inpatient progress" }).click();
      const draft = staleStay.locator("details[open] form");
      await fill(draft, {
        occurredAt: "2026-11-01T12:00",
        note: "Stale duplicate progress",
        changeReason: "Prior chart",
      });
      await act(stay, "Record inpatient progress", {
        occurredAt: "2026-11-01T10:00",
        ward: "South ward",
        note: "Staff progress observation",
        changeReason: "Ward transfer",
      });
      await expect(
        stay.getByRole("heading", { name: "Hospital stay · Inpatient progress" }),
      ).toBeVisible();
      await draft.getByRole("button", { name: "Record inpatient progress" }).click();
      await expect(draft.getByRole("alert")).toContainText("This record has changed");
    } finally {
      await stale.close();
    }
    expect(await ownerRecords()).toEqual([]);
    // Lose the acknowledgement after commit, then replay the exact discharge.
    let sent: { url: string; body: string | null } | undefined;
    await page.route(
      "**/clinical/**",
      async (route) => {
        sent = { url: route.request().url(), body: route.request().postData() };
        expect((await route.fetch()).status()).toBe(204);
        await route.fulfill({ status: 503, body: "" });
      },
      { times: 1 },
    );
    await act(stay, "Discharge patient", {
      occurredAt: "2026-11-01T15:00",
      note: "Private discharge note",
      summary: "Coco has been discharged.",
      changeReason: "Discharge visit",
    });
    await expect(stay.getByRole("alert")).toContainText("Retry");
    const [replay] = await Promise.all([
      page.waitForRequest((r) => r.url() === sent?.url && r.method() === "POST"),
      stay.getByRole("button", { name: "Retry submission" }).click(),
    ]);
    expect(replay.postData()).toBe(sent?.body);
    await expect(stay.getByRole("heading", { name: "Hospital stay · Discharged" })).toBeVisible();
    expect(await ownerRecords()).toEqual([]);
    async function release(entry: Locator) {
      await entry.getByText("Guardian access", { exact: true }).click();
      await expect(
        entry.getByText("Selected guardians can see the final status and guardian summary.", {
          exact: false,
        }),
      ).toBeVisible();
      await entry.getByRole("checkbox", { name: /Ari Vega/ }).check();
      await entry.getByRole("button", { name: "Save guardian access" }).click();
      await expect(
        entry.getByText("Final status and guardian summary shared with Ari Vega."),
      ).toBeVisible();
    }
    await release(stay);
    const [published] = await ownerRecords();
    expect(published.data).toEqual({ status: "DISCHARGED", summary: "Coco has been discharged." });
    await act(stay, "Correct final record", {
      summary: "Updated discharge summary.",
      changeReason: "Summary correction",
    });
    await expect(stay.getByText("Visible to clinic staff only.")).toBeVisible();
    expect(await ownerRecords()).toEqual([]);
    await stay.getByRole("link", { name: "View version history" }).click();
    const history = page.getByRole("region", { name: "Version history" });
    await expect(history.getByRole("listitem")).toHaveCount(4);
    await expect(history.getByText("Stale duplicate progress", { exact: true })).toHaveCount(0);
    await expect(history.getByText("Private discharge note", { exact: true })).toHaveCount(2);
    await page.getByRole("link", { name: "Back to current records" }).click();
    await create.locator("summary").click();
    await add(
      "surgery",
      {
        procedure: "Planned procedure",
        scheduledAt: "2026-11-02T11:00",
        notes: "Internal planning note",
      },
      "Plan surgery",
    );
    const surgery = chart
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: /^Surgery/ }) });
    await expect(surgery.getByRole("heading", { name: "Surgery · Planned" })).toBeVisible();
    await act(surgery, "Revise surgical plan", {
      occurredAt: "2026-11-01T11:00",
      scheduledAt: "2026-11-03T11:00",
      changeReason: "Schedule change",
    });
    await expect(surgery.locator("dd").filter({ hasText: "Schedule change" })).toBeVisible();
    await act(surgery, "Start surgery", {
      occurredAt: "2026-11-03T11:05",
      notes: "Private intraoperative note",
      changeReason: "Procedure started",
    });
    await expect(surgery.getByRole("heading", { name: "Surgery · In progress" })).toBeVisible();
    await expect(surgery.getByText("Revise surgical plan", { exact: true })).toHaveCount(0);
    await act(surgery, "Complete surgery", {
      occurredAt: "2026-11-03T13:00",
      performedProcedure: "Performed procedure",
      recoveryNotes: "Internal recovery entry",
      summary: "The procedure is complete.",
      changeReason: "Recovery handoff",
    });
    await expect(surgery.getByRole("heading", { name: "Surgery · Completed" })).toBeVisible();
    await release(surgery);
    const [completed] = await ownerRecords();
    expect(completed.data).toEqual({ status: "COMPLETED", summary: "The procedure is complete." });
    await add(
      "surgery",
      { procedure: "Second case", scheduledAt: "2026-11-04T12:00" },
      "Plan surgery",
    );
    const other = surgery.filter({ has: page.getByRole("heading", { name: "Surgery · Planned" }) });
    await act(other, "Cancel surgery", {
      occurredAt: "2026-11-01T09:30",
      summary: "This case was cancelled.",
      changeReason: "Family request",
    });
    await expect(chart.getByRole("heading", { name: "Surgery · Cancelled" })).toBeVisible();
    await page.getByRole("link", { name: "Español" }).click();
    await expect(
      chart.page().getByRole("heading", { name: "Hospitalización · Alta hospitalaria" }),
    ).toBeVisible();
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(result.violations.map((v) => v.id)).toEqual([]);
  } finally {
    await cleanup();
  }
});
