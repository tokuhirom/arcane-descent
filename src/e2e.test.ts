import { chromium, Browser, Page } from "playwright";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, ViteDevServer } from "vite";

let server: ViteDevServer;
let browser: Browser;
let page: Page;
let baseUrl: string;
const consoleLogs: string[] = [];
const consoleErrors: string[] = [];

beforeAll(async () => {
  server = await createServer({ server: { port: 0 } });
  await server.listen();
  const info = server.httpServer?.address();
  if (!info || typeof info === "string") throw new Error("Server failed");
  baseUrl = `http://localhost:${info.port}`;

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  page.on("console", (msg) => {
    const text = msg.text();
    consoleLogs.push(text);
    if (msg.type() === "error") consoleErrors.push(text);
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));
}, 30000);

afterAll(async () => {
  await page?.close();
  await browser?.close();
  await server?.close();
});

async function waitForGame() {
  await page.goto(baseUrl);
  // Wait for Phaser canvas to appear
  await page.waitForSelector("canvas", { timeout: 10000 });
  // Wait a bit for BootScene to create textures
  await page.waitForTimeout(1000);
}

async function clickCanvas(x: number, y: number) {
  const canvas = await page.$("canvas");
  if (!canvas) throw new Error("No canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("No canvas box");
  // Scale click to canvas coordinates
  const scaleX = box.width / 540;
  const scaleY = box.height / 960;
  await canvas.click({ position: { x: x * scaleX, y: y * scaleY } });
}

async function pressKey(key: string) {
  await page.keyboard.press(key);
}

async function holdKeyForMs(key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

describe("E2E: Game boot and play", () => {
  it("loads the game and shows title screen", async () => {
    await waitForGame();
    // Game should have loaded without errors
    const pageErrors = consoleErrors.filter((e) => !e.includes("favicon"));
    expect(pageErrors).toEqual([]);
  }, 15000);

  it("starts a run and moves around without crashing", async () => {
    consoleLogs.length = 0;
    consoleErrors.length = 0;

    // Click to start the game (title screen)
    await pressKey("Space");
    await page.waitForTimeout(500);

    // Move around with WASD for a few seconds
    await holdKeyForMs("d", 800);
    await holdKeyForMs("s", 800);
    await holdKeyForMs("a", 400);
    await holdKeyForMs("w", 400);

    // Wait for enemies to potentially engage
    await page.waitForTimeout(2000);

    // Move into enemy territory
    await holdKeyForMs("d", 1500);
    await holdKeyForMs("s", 500);

    // Wait for combat
    await page.waitForTimeout(3000);

    // Check for errors
    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes("favicon") && !e.includes("net::ERR")
    );
    if (criticalErrors.length > 0) {
      console.log("=== ERRORS ===");
      criticalErrors.forEach((e) => console.log(e));
    }
    expect(criticalErrors).toEqual([]);

    // Check for player broken state
    const playerBroken = consoleLogs.filter((l) => l.includes("Player broken"));
    if (playerBroken.length > 0) {
      console.log("=== PLAYER BROKEN ===");
      playerBroken.forEach((l) => console.log(l));
    }
    expect(playerBroken).toEqual([]);
  }, 20000);

  it("survives extended combat", async () => {
    consoleLogs.length = 0;
    consoleErrors.length = 0;

    // Start a fresh run
    await page.goto(baseUrl);
    await page.waitForSelector("canvas", { timeout: 10000 });
    await page.waitForTimeout(1000);
    await pressKey("Space");
    await page.waitForTimeout(500);

    // Explore aggressively in many directions
    const directions = ["d", "s", "d", "w", "d", "s", "a", "s", "d", "d", "s", "w", "a", "d", "s"];
    for (const dir of directions) {
      await holdKeyForMs(dir, 500);
      await page.waitForTimeout(200);
    }

    // Let combat play out longer
    await page.waitForTimeout(8000);

    const hitLogs = consoleLogs.filter((l) => l.startsWith("HIT:"));
    const activeSetFalse = consoleErrors.filter((l) => l.includes("Player.active set to false"));
    console.log(`=== Combat: ${hitLogs.length} hits taken ===`);
    hitLogs.forEach((l) => console.log(l));
    if (activeSetFalse.length > 0) {
      console.log("=== PLAYER DEACTIVATED ===");
      activeSetFalse.forEach((l) => console.log(l));
    }

    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes("favicon") && !e.includes("net::ERR")
    );
    if (criticalErrors.length > 0) {
      console.log("=== ERRORS DURING COMBAT ===");
      criticalErrors.forEach((e) => console.log(e));
    }
    expect(activeSetFalse).toEqual([]);
  }, 60000);

  it("stairs confirm cancel button works", async () => {
    consoleLogs.length = 0;
    consoleErrors.length = 0;

    await page.goto(baseUrl);
    await page.waitForSelector("canvas", { timeout: 10000 });
    await page.waitForTimeout(1000);
    await pressKey("Space");
    await page.waitForTimeout(2000);

    // Expose a test helper to teleport player to stairs and open the dialog
    await page.evaluate(() => {
      const game = (window as unknown as { game?: Phaser.Game }).game;
      if (!game) return;
      const dungeon = game.scene.getScene("DungeonScene") as unknown as {
        player: { x: number; y: number };
        stairs: { x: number; y: number; visible: boolean };
        scene: Phaser.Scenes.ScenePlugin;
        run: { floor: number };
      };
      if (!dungeon) return;
      // Force stairs visible and launch confirm dialog directly
      dungeon.stairs.visible = true;
      dungeon.scene.pause();
      dungeon.scene.launch("StairsConfirmScene", {
        floor: dungeon.run.floor,
        onDescend: () => { console.log("TEST:descended"); dungeon.scene.resume(); },
        onCancel: () => { console.log("TEST:cancelled"); dungeon.scene.resume(); }
      });
    });

    await page.waitForTimeout(500);

    // Click the "戻る" button (right side of dialog, roughly panel.x + 60)
    // Game is 540x960, panel is centered, "戻る" button at panel.x+60 = 330
    await clickCanvas(330, 520);
    await page.waitForTimeout(500);

    const cancelled = consoleLogs.filter((l) => l.includes("TEST:cancelled"));
    const descended = consoleLogs.filter((l) => l.includes("TEST:descended"));
    console.log(`Cancel clicks: ${cancelled.length}, Descend clicks: ${descended.length}`);
    expect(cancelled.length).toBeGreaterThan(0);
    expect(descended.length).toBe(0);
  }, 20000);
});
