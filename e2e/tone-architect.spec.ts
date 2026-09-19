import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { TEST_TONE } from "../src/test/fixtures";

const offlineDeviceResponse = {
  connected: false,
  devices: [],
  capabilities: {
    discovery: true,
    presetTransfer: false,
    reason: "Direct preset transfer is not available.",
  },
};

const readyTransferPreflight = {
  ready: true,
  firmware: "4.0.1/d14e",
  targetCells: ["1.1", "1.2", "1.3", "1.4"],
  requiredBlocks: 4,
  configuredScenes: 2,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/qc-device", async (route) => {
    await route.fulfill({ json: offlineDeviceResponse });
  });
});

test("serves the local app with defensive browser headers", async ({ request }) => {
  const response = await request.get("/");

  expect(response.status()).toBe(200);
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response.headers()["permissions-policy"]).toContain("camera=()");
});

test("integrates the browser, Next API, and provider client", async ({ page }) => {
  await page.goto("/");
  await page
    .getByLabel("Describe your desired sound")
    .fill("A complete progressive lead tone");
  await page.getByRole("button", { name: "Generate tone" }).click();

  await expect(
    page.getByRole("heading", { name: TEST_TONE.tone_name }),
  ).toBeVisible();
  await expect(page.getByText(TEST_TONE.description)).toBeVisible();
});

test("generates, exports, and restores a tone", async ({ page }) => {
  await page.route("**/api/generate-tone", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      prompt: "A focused progressive lead tone",
      target: "quad-cortex",
      owned_plugins: [],
    });
    await route.fulfill({ json: TEST_TONE });
  });

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Design your sound" }),
  ).toBeVisible();
  await expect(page.getByText("QC Offline")).toBeVisible();

  await page
    .getByLabel("Describe your desired sound")
    .fill("A focused progressive lead tone");
  await page.getByRole("button", { name: "Generate tone" }).click();

  await expect(
    page.getByRole("heading", { name: TEST_TONE.tone_name }),
  ).toBeVisible();
  await expect(page.getByText("CA JP-2C")).toBeVisible();
  await expect(page.getByText("Block 1.4 — MIX: 0")).toBeVisible();

  await page.getByRole("button", { name: "Edit parameters" }).click();
  const gainInput = page.getByLabel("CA JP-2C GAIN");
  await gainInput.fill("64");
  await expect(gainInput).toHaveValue("64");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("focused-modern-lead.json");
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const exportedTone = JSON.parse(await readFile(downloadedPath!, "utf8"));
  expect(exportedTone.signal_chain[1].parameters.GAIN).toBe(64);

  await page.reload();
  await expect(page.getByText("Saved tones")).toBeVisible();
  await page.getByRole("button", { name: new RegExp(TEST_TONE.tone_name) }).click();
  await expect(
    page.getByRole("heading", { name: TEST_TONE.tone_name }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit parameters" }).click();
  await expect(page.getByLabel("CA JP-2C GAIN")).toHaveValue("64");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Clear history" }).click();
  await expect(page.getByText("Saved tones")).not.toBeVisible();
  await page.reload();
  await expect(page.getByText("Saved tones")).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Design your sound" }),
  ).toBeVisible();
});

test("sends licensed plugin access only after explicit opt-in", async ({ page }) => {
  await page.route("**/api/generate-tone", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      prompt: "A licensed Rabea lead tone",
      target: "quad-cortex",
      owned_plugins: ["archetype-rabea-x"],
    });
    await route.fulfill({ json: TEST_TONE });
  });

  await page.goto("/");
  await page
    .getByRole("checkbox", { name: /Include Archetype: Rabea X devices/ })
    .check();
  await page
    .getByLabel("Describe your desired sound")
    .fill("A licensed Rabea lead tone");
  await page.getByRole("button", { name: "Generate tone" }).click();

  await expect(
    page.getByRole("heading", { name: TEST_TONE.tone_name }),
  ).toBeVisible();
});

test("shows a recoverable model error and keeps the prompt", async ({ page }) => {
  await page.route("**/api/generate-tone", async (route) => {
    await route.fulfill({
      status: 502,
      json: { error: "Tone generation is temporarily unavailable" },
    });
  });

  await page.goto("/");
  const input = page.getByLabel("Describe your desired sound");
  await input.fill("A glassy clean tone");
  await page.getByRole("button", { name: "Generate tone" }).click();

  await expect(
    page.getByText("Tone generation is temporarily unavailable"),
  ).toBeVisible();
  await expect(input).toHaveValue("A glassy clean tone");
  await expect(page.getByRole("button", { name: "Generate tone" })).toBeEnabled();
});

test("opens a camera-ready preset with recording checks", async ({ page }) => {
  await page.goto("/");

  await page
    .getByRole("button", { name: "iPhone / Final Cut Camera" })
    .click();
  await page.getByRole("button", { name: /Modern Jazz/ }).click();

  await expect(
    page.getByRole("heading", { name: "Camera Velvet Jazz" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Ready for Final Cut Camera" }),
  ).toBeVisible();
  await expect(page.getByText("Scene level compensation")).toBeVisible();
  await expect(
    page.getByText("Settings → Audio → Source → Quad Cortex, then choose Stereo."),
  ).toBeVisible();
});

test("reports a connected Quad Cortex", async ({ page }) => {
  await page.unroute("**/api/qc-device");
  await page.route("**/api/qc-device", async (route) => {
    await route.fulfill({
      json: {
        connected: true,
        devices: [
          {
            vendorId: "0x152a",
            productId: "0x880a",
            manufacturer: "Neural DSP",
            product: "Quad Cortex",
            serialNumber: "QC-E2E",
          },
        ],
        capabilities: { discovery: true, presetTransfer: true },
      },
    });
  });

  await page.goto("/");

  await expect(page.getByText("QC Connected")).toBeVisible();
});

test("confirms, transfers, and reports a verified hardware transaction", async ({ page }) => {
  await page.unroute("**/api/qc-device");
  await page.route("**/api/qc-device", async (route) => {
    await route.fulfill({
      json: {
        connected: true,
        devices: [{
          vendorId: "0x152a",
          productId: "0x880a",
          manufacturer: "Neural DSP",
          product: "Quad Cortex",
          serialNumber: "QC-E2E",
        }],
        capabilities: { discovery: true, presetTransfer: true },
      },
    });
  });
  await page.route("**/api/generate-tone", async (route) => {
    await route.fulfill({ json: TEST_TONE });
  });
  let preflightRequests = 0;
  await page.route("**/api/qc-transfer/preflight", async (route) => {
    preflightRequests += 1;
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ tone: TEST_TONE });
    await route.fulfill({ json: readyTransferPreflight });
  });
  await page.route("**/api/qc-transfer", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      tone: TEST_TONE,
      confirmation: "APPLY_TO_EMPTY_PRESET",
    });
    await route.fulfill({
      json: {
        ok: true,
        appliedBlocks: 4,
        appliedParameters: 11,
        configuredScenes: 2,
        firmware: "4.0.1/d14e",
      },
    });
  });

  await page.goto("/");
  await page
    .getByLabel("Describe your desired sound")
    .fill("Transfer-ready progressive lead");
  await page.getByRole("button", { name: "Generate tone" }).click();
  const transfer = page.getByRole("button", { name: "Transfer to QC" });
  await expect(transfer).toBeEnabled();

  page.once("dialog", (dialog) => dialog.accept());
  await transfer.click();

  await expect(
    page.getByText(
      "Transferred and verified 4 blocks and 2 scenes. Save the preset on the QC to keep it.",
    ),
  ).toBeVisible();
  expect(preflightRequests).toBe(1);
});

test("does not write without confirmation and surfaces a preflight refusal", async ({ page }) => {
  await page.unroute("**/api/qc-device");
  await page.route("**/api/qc-device", async (route) => {
    await route.fulfill({
      json: {
        connected: true,
        devices: [{
          vendorId: "0x152a",
          productId: "0x880a",
          manufacturer: "Neural DSP",
          product: "Quad Cortex",
        }],
        capabilities: { discovery: true, presetTransfer: true },
      },
    });
  });
  await page.route("**/api/generate-tone", async (route) => {
    await route.fulfill({ json: TEST_TONE });
  });
  let preflightRequests = 0;
  await page.route("**/api/qc-transfer/preflight", async (route) => {
    preflightRequests += 1;
    if (preflightRequests === 1) {
      await route.fulfill({ json: readyTransferPreflight });
      return;
    }
    await route.fulfill({
      status: 422,
      json: {
        error: "Target cells are occupied (1.2). Load an empty preset before applying this tone.",
      },
    });
  });
  let transferRequests = 0;
  await page.route("**/api/qc-transfer", async (route) => {
    transferRequests += 1;
    await route.fulfill({ json: { ok: true } });
  });

  await page.goto("/");
  await page
    .getByLabel("Describe your desired sound")
    .fill("Safe transfer refusal");
  await page.getByRole("button", { name: "Generate tone" }).click();
  const transfer = page.getByRole("button", { name: "Transfer to QC" });
  await expect(transfer).toBeEnabled();

  page.once("dialog", (dialog) => dialog.dismiss());
  await transfer.click();
  expect(transferRequests).toBe(0);
  expect(preflightRequests).toBe(1);
  await expect(transfer).toBeEnabled();

  await transfer.click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Target cells are occupied" }),
  ).toBeVisible();
  expect(preflightRequests).toBe(2);
  expect(transferRequests).toBe(0);
});

test("meets automated WCAG accessibility checks", async ({ page }) => {
  await page.goto("/");

  const initialResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(initialResults.violations).toEqual([]);

  await page.route("**/api/generate-tone", async (route) => {
    await route.fulfill({ json: TEST_TONE });
  });
  await page
    .getByLabel("Describe your desired sound")
    .fill("Accessible progressive lead");
  await page.getByRole("button", { name: "Generate tone" }).click();
  await expect(
    page.getByRole("heading", { name: TEST_TONE.tone_name }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit parameters" }).click();

  const populatedResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(populatedResults.violations).toEqual([]);
});
