/** Run a packaged Windows bitmap workflow in an isolated, disposable profile. */
import { _electron as electron } from "playwright";
import type { ElectronApplication, Page } from "playwright";
import { expect } from "@playwright/test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { BitmapImport, CanvasLayout } from "../src/types/index.ts";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXECUTABLE = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, "release", "stage-2", "win-unpacked", "terraForge.exe");
const PREFIX = "terraforge-bitmap-package-smoke-";
const normalise = (value: string) => path.resolve(value).toLowerCase();
function assertTemporaryRoot(directory: string) {
    if (normalise(path.dirname(directory)) !== normalise(tmpdir()) || !path.basename(directory).startsWith(PREFIX)) {
        throw new Error("Refusing an operation outside this bitmap smoke test's temporary root.");
    }
}
async function main() {
    if (process.platform !== "win32")
        throw new Error("The packaged bitmap smoke test supports Windows only.");
    if (!existsSync(EXECUTABLE))
        throw new Error(`Packaged executable not found: ${EXECUTABLE}`);
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), PREFIX));
    assertTemporaryRoot(temporaryRoot);
    const profile = path.join(temporaryRoot, "user-data");
    const source = path.join(temporaryRoot, "portable.PNG");
    const savedFile = path.join(temporaryRoot, "portable.tforge");
    const secondSave = path.join(temporaryRoot, "reopened.tforge");
    const screenshot = path.join(ROOT, ".cache", "stage2-package.png");
    mkdirSync(profile);
    copyFileSync(path.join(ROOT, "tests", "fixtures", "bitmaps", "transparent.png"), source);
    let application: ElectronApplication | undefined;
    let success: Record<string, unknown> | undefined;
    const close = async () => { if (application) {
        const running = application;
        application = undefined;
        await running.close();
    } };
    const launch = async () => {
        application = await electron.launch({ executablePath: EXECUTABLE, args: [`--user-data-dir=${profile}`], cwd: ROOT,
            env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined }, timeout: 30000 });
        const identity = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, userData: app.getPath("userData"), electronVersion: process.versions.electron }));
        if (!identity.packaged || normalise(identity.userData) !== normalise(profile))
            throw new Error("Refusing smoke-test actions: packaged app did not use the isolated temporary profile.");
        const page = await application.firstWindow();
        await page.getByRole("combobox", { name: "Machine selector" }).waitFor({ timeout: 15000 });
        return { page, electronVersion: identity.electronVersion };
    };
    const menu = async (page: Page, channel: "menu:saveLayout" | "menu:openLayout") => {
        const native = await application!.browserWindow(page);
        try {
            await native.evaluate((main, action) => main.webContents.send(action), channel);
        }
        finally {
            await native.dispose();
        }
    };
    const save = async (page: Page, filename: string) => {
        await application!.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, filename);
        await menu(page, "menu:saveLayout");
        await expect.poll(() => { try {
            return (JSON.parse(readFileSync(filename, "utf8")) as CanvasLayout).imports.length;
        }
        catch {
            return -1;
        } }).toBe(1);
        return JSON.parse(readFileSync(filename, "utf8")) as CanvasLayout;
    };
    const artwork = (page: Page) => page.locator("span[title='Double-click to rename']").filter({ hasText: /^portable$/ });
    const assertImageRendered = async (page: Page) => {
        const imageBox = await page.locator("g[style*='cursor: grab'] > rect").first().boundingBox();
        if (!imageBox)
            throw new Error("Bitmap hit area is missing.");
        await expect.poll(() => page.evaluate(({ imageBox }) => {
            const canvas = document.querySelector<HTMLCanvasElement>("canvas[data-testid='toolpath-canvas']")!;
            const bounds = canvas.getBoundingClientRect();
            const x = Math.floor((imageBox.x + imageBox.width / 8 - bounds.x) * canvas.width / bounds.width);
            const y = Math.floor((imageBox.y + imageBox.height / 2 - bounds.y) * canvas.height / bounds.height);
            const pixel = canvas.getContext("2d")!.getImageData(x, y, 1, 1).data;
            return pixel[0] > 100 && pixel[1] < 80 && pixel[2] < 80;
        }, { imageBox }), { timeout: 10000 }).toBe(true);
    };
    try {
        const first = await launch();
        const page = first.page;
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await application!.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, source);
        await page.getByRole("button", { name: "Import", exact: true }).click();
        await expect(artwork(page)).toBeVisible();
        await expect(page.getByRole("button", { name: "Generate G-code", exact: true })).toBeDisabled();
        await page.getByText("W (mm)", { exact: true }).locator("..").locator("input").fill("100");
        await page.getByLabel("X (mm)", { exact: true }).fill("25");
        await page.getByLabel("Y (mm)", { exact: true }).fill("15");
        const opacity = page.getByRole("slider", { name: "Opacity (%)" });
        for (let step = 0; step < 50; step++)
            await opacity.press("ArrowLeft");
        await assertImageRendered(page);
        const saved = await save(page, savedFile);
        expect(saved.tfVersion).toBe(2);
        const item = saved.imports[0] as BitmapImport;
        expect(item).toMatchObject({ kind: "bitmap", name: "portable", x: 25, y: 15, svgWidth: 4, svgHeight: 2, opacity: 0.5 });
        expect(item.svgWidth * (item.scaleX ?? item.scale)).toBeCloseTo(100);
        expect(Object.keys(saved.assets!)).toHaveLength(1);
        expect(saved.assets![item.assetId]).toMatchObject({ mimeType: "image/png", widthPx: 4, heightPx: 2 });
        expect(errors).toEqual([]);
        await close();
        assertTemporaryRoot(temporaryRoot);
        if (normalise(path.dirname(source)) !== normalise(temporaryRoot))
            throw new Error("Refusing to delete a source outside the temporary root.");
        rmSync(source);
        const second = await launch();
        const reopened = second.page;
        reopened.on("pageerror", error => errors.push(error.message));
        await application!.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, savedFile);
        await menu(reopened, "menu:openLayout");
        await expect(artwork(reopened)).toBeVisible();
        await artwork(reopened).click();
        await expect(reopened.getByRole("slider", { name: "Opacity (%)" })).toHaveValue("50");
        await assertImageRendered(reopened);
        const restored = await save(reopened, secondSave);
        expect(restored.imports[0]).toEqual(item);
        expect(restored.assets).toEqual(saved.assets);
        await expect(reopened.getByRole("button", { name: "Generate G-code", exact: true })).toBeDisabled();
        await reopened.getByRole("button", { name: "Plugins", exact: true }).click();
        await reopened.getByRole("menuitem", { name: "Add Example Generator", exact: true }).click();
        const plugin = reopened.getByRole("region", { name: "Plugin: Example Grid", exact: true });
        await plugin.getByRole("button", { name: "Add artwork", exact: true }).click();
        await expect(reopened.locator("span[title='Double-click to rename']").filter({ hasText: /^Example Grid$/ })).toBeVisible({ timeout: 35000 });
        await expect(reopened.getByRole("button", { name: "Generate G-code", exact: true })).toBeEnabled();
        await plugin.getByRole("button", { name: "Close plugin panel" }).click();
        await artwork(reopened).click();
        expect(errors).toEqual([]);
        mkdirSync(path.dirname(screenshot), { recursive: true });
        await reopened.screenshot({ path: screenshot });
        success = { status: "passed", packaged: true, executable: EXECUTABLE, electronVersion: first.electronVersion,
            bitmapPixels: [4, 2], physicalWidthMM: 100, opacity: 0.5, portableAfterSourceDeletion: true,
            identicalAssetAndPlacement: true, canvasPixelsVerified: true, rasterOnlyPlottingDisabled: true,
            mixedVectorPlottingEnabled: true, temporaryProfileRemoved: true, screenshot };
    }
    finally {
        try {
            await close();
        }
        finally {
            assertTemporaryRoot(temporaryRoot);
            rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
        }
    }
    process.stdout.write(`${JSON.stringify(success, null, 2)}\n`);
}
void main().catch((error: unknown) => { process.stderr.write(`Packaged bitmap smoke test failed: ${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
