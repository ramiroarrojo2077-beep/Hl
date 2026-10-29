import { expect, test } from "@playwright/test";

test("interfaz móvil: paneles deslizables y controles táctiles", async ({ page }) => {
  await page.goto("/editor?template=small-town");
  await page.waitForURL(/\/editor\?id=w_/, { timeout: 90_000 });
  await expect(page.getByTestId("mobile-hierarchy")).toBeVisible();
  await page.getByTestId("mobile-hierarchy").click();
  await expect(page.getByTestId("sheet-hierarchy")).toBeVisible();
  await page.getByTestId("mobile-ai").click();
  await expect(page.getByTestId("ai-panel")).toBeVisible();
  await page.getByTestId("mobile-ai").click();
  await page.getByTestId("explore-button").click();
  await expect(page.getByTestId("joystick")).toBeVisible();
  await expect(page.getByTestId("jump")).toBeVisible();
});
