import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function expectViewportCanvas(page: Page) {
  const metrics = await page.evaluate(() => {
    const app = document.getElementById("app")?.getBoundingClientRect();
    const shell = document.querySelector(".game-shell")?.getBoundingClientRect();

    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      app: {
        width: app?.width ?? 0,
        height: app?.height ?? 0,
      },
      shell: {
        width: shell?.width ?? 0,
        height: shell?.height ?? 0,
      },
      scroll: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      bodyOverflow: getComputedStyle(document.body).overflow,
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
    };
  });

  expect(metrics.bodyOverflow).toBe("hidden");
  expect(metrics.htmlOverflow).toBe("hidden");
  expect(Math.abs(metrics.app.width - metrics.viewport.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.app.height - metrics.viewport.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.shell.width - metrics.viewport.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics.shell.height - metrics.viewport.height)).toBeLessThanOrEqual(1);
  expect(metrics.scroll.width).toBeLessThanOrEqual(metrics.viewport.width + 2);
  expect(metrics.scroll.height).toBeLessThanOrEqual(metrics.viewport.height + 2);
}

async function expectInsideViewport(page: Page, selector: string) {
  const rect = await page.locator(selector).first().boundingBox();
  const viewport = page.viewportSize();

  expect(rect).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(rect!.x).toBeGreaterThanOrEqual(-1);
  expect(rect!.y).toBeGreaterThanOrEqual(-1);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

test("starts in count mode and can switch to pattern training", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Block Memory" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(page.getByText("Count Mode")).toBeVisible();
  await expect(page.getByText(/\b4 cubes\b/i)).toHaveCount(0);
  await expect(page.locator(".board")).toHaveCount(0);
  await expectViewportCanvas(page);

  await page.getByRole("tab", { name: "Pattern" }).click();
  await page.getByLabel("Training").check();

  await expect(page.getByText("Pattern Mode")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(page.getByText(/\b3 cubes\b/i)).toHaveCount(0);
});

test("shows active blocks immediately after start", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Start" }).click();

  await expect(page.getByText("Memorize").first()).toBeVisible();
  await expect(page.locator(".board-screen .screen-label")).not.toContainText(/\b4 cubes\b/i);
  await expect(page.getByRole("button", { name: "Submit" })).toHaveCount(0);
  await expect(page.locator(".block.is-active")).toHaveCount(4);
  await expectViewportCanvas(page);
  await expectInsideViewport(page, ".board");
});

test("moves from preview to a separate count submit screen", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".block.is-active")).toHaveCount(4);

  await expect(page.getByRole("button", { name: "Submit" })).toBeVisible({ timeout: 4000 });
  const countInput = page.getByRole("spinbutton", { name: "Cubes" });
  await expect(countInput).toBeVisible();
  await expect(countInput).toHaveValue("0");
  await countInput.click();
  await expect(countInput).toHaveValue("");
  await page.keyboard.type("4");
  await expect(countInput).toHaveValue("4");
  await expect(page.locator(".board")).toHaveCount(0);
  await expectViewportCanvas(page);
  await expectInsideViewport(page, ".submit-button");
});

test("keeps pattern recall board and submit inside the viewport", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("tab", { name: "Pattern" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.locator(".block.is-active")).toHaveCount(3);
  await expect(page.locator(".board-screen .screen-label")).not.toContainText(/\b3 cubes\b/i);

  await expect(page.getByRole("button", { name: "Submit" })).toBeVisible({ timeout: 5000 });
  await expect(page.locator(".pattern-screen .screen-label")).not.toContainText(/\d+\/\d+\s+selected/i);
  await expectViewportCanvas(page);
  await expectInsideViewport(page, ".pattern-screen .board");
  await expectInsideViewport(page, ".submit-button");
});
