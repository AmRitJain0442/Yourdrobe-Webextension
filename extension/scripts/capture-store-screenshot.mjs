import { access, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(extensionRoot, "..");
const extensionPath = resolve(extensionRoot, "dist");
const catalogOutputPath = resolve(repositoryRoot, "store-assets", "screenshot-catalog.png");
const profileOutputPath = resolve(repositoryRoot, "store-assets", "screenshot-profile-setup.png");
const executablePath = process.env.CHROME_EXECUTABLE
  || resolve(tmpdir(), "yourdrobe-cft-151", "chrome-win64", "chrome.exe");

await Promise.all([access(executablePath), access(resolve(extensionPath, "manifest.json"))]);
await mkdir(dirname(catalogOutputPath), { recursive: true });

const browser = await puppeteer.launch({
  executablePath,
  headless: false,
  enableExtensions: [extensionPath],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  args: ["--window-size=1280,800", "--no-first-run", "--no-default-browser-check"],
});

try {
  const page = await browser.newPage();
  await page.goto("https://www.amazon.in/s?k=women+dresses", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000));

  const extensions = await browser.extensions();
  const extension = [...extensions.values()].find((candidate) => candidate.name === "Yourdrobe AI Try-On");
  if (!extension) throw new Error("Yourdrobe was not loaded in Chrome for Testing.");

  await extension.triggerAction(page);
  const sidePanelTarget = await browser.waitForTarget(
    (target) => target.url().endsWith("/sidepanel.html"),
    { timeout: 15_000 },
  );
  const sidePanel = await sidePanelTarget.asPage();
  if (!sidePanel) throw new Error("The Yourdrobe side panel did not expose a page target.");

  await sidePanel.setViewport({ width: 640, height: 400, deviceScaleFactor: 2 });
  await sidePanel.waitForSelector("main", { timeout: 15_000 });
  await sidePanel.waitForSelector(".catalog-card", { timeout: 30_000 });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  await sidePanel.screenshot({ path: catalogOutputPath, type: "png" });

  const tryOnButton = await sidePanel.waitForSelector("button.ai-button", { timeout: 15_000 });
  await tryOnButton.click();
  await sidePanel.waitForSelector('input[type="file"]', { timeout: 15_000 });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  await sidePanel.evaluate(() => window.scrollTo(0, 0));
  await sidePanel.screenshot({ path: profileOutputPath, type: "png" });
  process.stdout.write(`${catalogOutputPath}\n${profileOutputPath}\n`);
} finally {
  await browser.close();
}
