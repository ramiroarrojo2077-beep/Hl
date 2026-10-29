import { expect, test } from "@playwright/test";

/**
 * Criterio principal de éxito: escribir la descripción, obtener una escena 3D
 * real, editar un edificio a mano y por texto, guardar y reabrir con los
 * cambios conservados. Después, explorar el mundo.
 */
test("crear, editar, guardar, reabrir y explorar", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await page.getByTestId("home-prompt").fill("Creá una pequeña ciudad rodeada de montañas, con edificios, calles, árboles y personas caminando");
  await page.getByTestId("home-create").click();

  // La generación muestra etapas reales y termina con el proyecto guardado.
  await page.waitForURL(/\/editor\?id=w_/, { timeout: 90_000 });
  await expect(page.getByTestId("save-status")).toHaveText(/Guardado/);
  await expect(page.locator("canvas").first()).toBeVisible();

  // Jerarquía con las carpetas del mundo.
  for (const folder of ["Terrain", "Buildings", "Vegetation", "Characters", "Vehicles", "Lighting", "Weather", "Cameras"]) {
    await expect(page.getByTestId(`row-${folder}`)).toBeVisible();
  }

  // Seleccionar un edificio desde la jerarquía.
  await page.getByTestId("row-Buildings").locator("button").first().click();
  await page.getByTestId("row-Building_001").click();
  await expect(page.getByTestId("inspector")).toBeVisible();
  const floorsBefore = Number(await page.getByTestId("floors").inputValue());

  // Edición por texto con vista previa.
  await page.getByTestId("tab-ai").click();
  await page.getByTestId("ai-input").fill("Hacé que este edificio sea más alto y cambiá el material por ladrillos");
  await page.getByTestId("ai-send").click();
  await expect(page.getByTestId("ai-preview")).toBeVisible();
  await page.getByTestId("ai-apply").click();
  await page.getByTestId("tab-inspector").click();
  const floorsAfter = Number(await page.getByTestId("floors").inputValue());
  expect(floorsAfter).toBeGreaterThan(floorsBefore);
  await expect(page.getByTestId("wall-material")).toHaveValue("brick");

  // Edición manual de la posición.
  const x0 = Number(await page.getByTestId("pos-x").inputValue());
  await page.getByTestId("pos-x").fill(String(x0 + 5));
  await page.getByTestId("pos-x").press("Enter");
  await expect(page.getByTestId("save-status")).toHaveText(/Sin guardar/);

  // Deshacer y rehacer la edición manual.
  await page.getByTestId("undo").click();
  await expect(page.getByTestId("pos-x")).toHaveValue(String(x0));
  await page.getByTestId("redo").click();
  await expect(page.getByTestId("pos-x")).toHaveValue(String(x0 + 5));

  // Guardar y reabrir.
  await page.getByTestId("save-button").click();
  await expect(page.getByTestId("save-status")).toHaveText(/Guardado/);
  await page.reload();
  await page.getByTestId("row-Buildings").locator("button").first().click();
  await page.getByTestId("row-Building_001").click();
  await expect(page.getByTestId("floors")).toHaveValue(String(floorsAfter));
  await expect(page.getByTestId("pos-x")).toHaveValue(String(x0 + 5));
  await expect(page.getByTestId("wall-material")).toHaveValue("brick");

  // Explorar y volver sin modificar el mundo.
  await page.getByTestId("explore-button").click();
  await expect(page.getByTestId("explore-overlay")).toBeVisible();
  await page.keyboard.down("KeyW");
  await page.waitForTimeout(1200);
  await page.keyboard.up("KeyW");
  await page.getByTestId("exit-explore").click();
  await expect(page.getByTestId("save-status")).toHaveText(/Guardado/);

  expect(errors).toEqual([]);
});
