import { expect, test } from "@playwright/test";

test("starts in count mode and can switch to pattern training", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Block Memory" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(page.getByText("Count Mode")).toBeVisible();
  await expect(page.locator(".board")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 2)).toBe(true);

  await page.getByRole("tab", { name: "Pattern" }).click();
  await page.getByLabel("Training").check();

  await expect(page.getByText("Pattern Mode")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
});

test("shows active blocks immediately after start", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByText("Memorize").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit" })).toHaveCount(0);
  await expect(page.locator(".block.is-active")).toHaveCount(4);
  await expect(page.locator(".board")).toBeInViewport();
});

test("moves from preview to a separate count submit screen", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".block.is-active")).toHaveCount(4);

  await expect(page.getByRole("button", { name: "Submit" })).toBeVisible({ timeout: 4000 });
  await expect(page.getByRole("spinbutton", { name: "Cubes" })).toBeVisible();
  await expect(page.locator(".board")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 2)).toBe(true);
});
