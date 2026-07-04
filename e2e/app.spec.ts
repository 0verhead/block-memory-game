import { expect, test } from "@playwright/test";

test("starts in count mode and can switch to pattern training", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Block Memory" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(page.getByText("Count Mode")).toBeVisible();

  await page.getByRole("tab", { name: "Pattern" }).click();
  await page.getByLabel("Training").check();

  await expect(page.getByText("Pattern Mode")).toBeVisible();
  await expect(page.getByText("0 selected")).toBeVisible();
});
