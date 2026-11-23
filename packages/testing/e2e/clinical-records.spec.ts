import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openClinicalChart } from "./support/clinical-chart.js";
test.use({ trace: "off" });
test.setTimeout(120_000);

test("staff chart typed records, review a lab result and release only its current reviewed version", async ({
  browser,
  page,
  request,
}) => {
  page.setDefaultTimeout(15_000);
  const { encounterId, endpoint, ownerRecords, cleanup } = await openClinicalChart(
    page,
    browser,
    request,
  );
  try {
    expect((await page.request.get(page.url())).headers()["cache-control"]).toContain("no-store");
    const forged = await page.request.post(endpoint + "/" + randomUUID() + "/" + randomUUID(), {
      data: {},
      headers: { Origin: new URL(page.url()).origin, "X-VetX-CSRF": "invalid" },
    });
    expect(forged.status()).toBe(403);
    expect(forged.headers()["cache-control"]).toContain("no-store");
    const create = page.getByRole("region", { name: "Add a clinical record" }),
      chart = page.getByRole("region", { name: "Current records" });
    await create.getByText("Add a clinical record", { exact: true }).click();
    const add = async (kind: string, values: Record<string, string>) => {
      await create
        .getByRole("combobox", { name: "Encounter", exact: true })
        .selectOption(encounterId);
      await create.getByRole("combobox", { name: "Record type", exact: true }).selectOption(kind);
      for (const [name, value] of Object.entries(values))
        await create.locator('[name="' + name + '"]').fill(value);
      await create
        .getByRole("button", {
          name: kind === "lab" ? "Order a lab test" : "Save record",
          exact: true,
        })
        .click();
    };
    // A lost response must replay the exact same mutation for the first record.
    let firstUrl = "",
      firstBody = "";
    await page.route(
      "**/clinical/**",
      async (route) => {
        firstUrl = route.request().url();
        firstBody = route.request().postData()!;
        expect((await route.fetch()).status()).toBe(204);
        await route.fulfill({ status: 408, body: "" });
      },
      { times: 1 },
    );
    await add("diagnosis", { diagnosis: "Entered finding", code: "A-4" });
    await expect(create.getByRole("alert")).toContainText("Retry");
    await expect(create.locator('[name="diagnosis"]')).toBeDisabled();
    const [replayed] = await Promise.all([
      page.waitForRequest((r) => r.url() === firstUrl && r.method() === "POST"),
      create.getByRole("button", { name: "Retry submission" }).click(),
    ]);
    expect(replayed.postData()).toBe(firstBody);
    const diagnosis = chart
      .getByRole("listitem")
      .filter({ has: page.getByRole("heading", { name: "Diagnosis", exact: true }) });
    await expect(diagnosis).toHaveCount(1);
    await expect(diagnosis.locator("dd").filter({ hasText: "Entered finding" })).toBeVisible();
    await diagnosis.getByText("Correct this record", { exact: true }).click();
    const amendment = diagnosis.locator("details[open] form");
    await amendment.locator('[name="diagnosis"]').fill("Amended finding");
    await amendment.getByLabel("Reason for this version").fill("Transcription correction");
    await amendment.getByRole("button", { name: "Save new version" }).click();
    await expect(diagnosis.locator("dd").filter({ hasText: "Amended finding" })).toBeVisible();
    await diagnosis.getByText("Guardian access", { exact: true }).click();
    await diagnosis.getByRole("checkbox", { name: /Ari Vega/ }).check();
    await diagnosis.getByRole("button", { name: "Save guardian access" }).click();
    await expect(diagnosis.getByText("Shared with Ari Vega.")).toBeVisible();
    expect(await ownerRecords()).toMatchObject([
      { revision: 2, kind: "diagnosis", data: { diagnosis: "Amended finding" } },
    ]);
    await diagnosis.getByText("Guardian access", { exact: true }).click();
    await diagnosis.getByRole("checkbox", { name: /Ari Vega/ }).uncheck();
    await diagnosis.getByRole("button", { name: "Save guardian access" }).click();
    await expect(diagnosis.getByText("Visible to clinic staff only.")).toBeVisible();
    expect(await ownerRecords()).toEqual([]);
    await add("treatment", { treatment: "Recorded treatment", notes: "Observed in clinic" });
    await expect(chart.locator("dd").filter({ hasText: "Recorded treatment" })).toBeVisible();
    await add("vaccination", {
      vaccine: "Recorded vaccine",
      lotNumber: "LOT-VX",
      nextDueDate: "2027-11-22",
    });
    await expect(chart.locator("dd").filter({ hasText: "LOT-VX" })).toBeVisible();
    await add("lab", { test: "Reference panel", specimen: "Slide" });
    const lab = chart
      .getByRole("listitem")
      .filter({ has: page.getByText("Reference panel", { exact: true }) });
    await expect(lab.getByRole("heading", { name: "Laboratory test · Ordered" })).toBeVisible();
    await expect(lab.getByText("Guardian access", { exact: true })).toHaveCount(0);
    await lab.getByText("Enter result", { exact: true }).click();
    const result = lab.locator("details[open] form");
    await result.locator('[name="result"]').fill("Entered result");
    await result.locator('[name="unit"]').fill("U");
    await result.getByLabel("Reason for this version").fill("Report received");
    await result.getByRole("button", { name: "Save new version" }).click();
    await expect(
      lab.getByRole("heading", { name: "Laboratory test · Result awaiting review" }),
    ).toBeVisible();
    expect(await ownerRecords()).toEqual([]);
    await lab.getByText("Review this result", { exact: true }).click();
    const review = lab.locator("details[open] form");
    await expect(review.locator('[name="result"]')).toHaveCount(0);
    await review.getByLabel("Reason for this version").fill("Report verified");
    await review.getByRole("button", { name: "Confirm review" }).click();
    await expect(lab.getByRole("heading", { name: "Laboratory test · Reviewed" })).toBeVisible();
    expect(await ownerRecords()).toEqual([]);
    await lab.getByText("Guardian access", { exact: true }).click();
    const share = lab.locator("details[open] form");
    await share.getByRole("checkbox", { name: /Ari Vega/ }).check();
    await share.getByRole("button", { name: "Save guardian access" }).click();
    await expect(lab.getByText("Shared with Ari Vega.")).toBeVisible();
    expect(await ownerRecords()).toMatchObject([
      { revision: 3, data: { status: "REVIEWED", result: "Entered result" } },
    ]);
    await lab.getByText("Correct result", { exact: true }).click();
    const correction = lab
      .locator("details[open] form")
      .filter({ has: page.getByLabel("Reason for this version") });
    await correction.locator('[name="result"]').fill("Corrected result");
    await correction.getByLabel("Reason for this version").fill("Amended report");
    await correction.getByRole("button", { name: "Save new version" }).click();
    await expect(
      lab.getByRole("heading", { name: "Laboratory test · Result awaiting review" }),
    ).toBeVisible();
    expect(await ownerRecords()).toEqual([]);
    await lab.getByRole("link", { name: "View version history" }).click();
    const history = page.getByRole("region", { name: "Version history" });
    await expect(history.getByRole("listitem")).toHaveCount(4);
    await expect(history.getByRole("listitem").first()).toContainText("Corrected result");
    await expect(history.getByRole("listitem").nth(1)).toContainText("Entered result");
    await expect(history.getByRole("button")).toHaveCount(0);
    await page.getByRole("link", { name: "Español" }).click();
    await expect(page.getByRole("heading", { name: "Historial de versiones" })).toBeVisible();
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
    ).toBe(true);
  } finally {
    await cleanup();
  }
});
