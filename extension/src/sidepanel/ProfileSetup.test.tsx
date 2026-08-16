// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareProfileImage } from "../profile/image";
import { saveAsset } from "../profile/store";
import { generateProfileAssets } from "./api";
import { ProfileSetup } from "./ProfileSetup";

vi.mock("../profile/image", () => ({ prepareProfileImage: vi.fn() }));
vi.mock("../profile/store", () => ({ saveAsset: vi.fn() }));
vi.mock("./api", () => ({ generateProfileAssets: vi.fn() }));

const roles = ["face_front", "face_left", "face_right", "full_body_front", "full_body_side"] as const;
let root: Root;
let host: HTMLDivElement;
const onSaved = vi.fn();

function choose(file = new File(["photo"], "person.jpg", { type: "image/jpeg" })) {
  const input = host.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function click(name: string) {
  await act(async () => {
    [...host.querySelectorAll("button")].find((button) => button.textContent === name)?.click();
    await new Promise((resolve) => setTimeout(resolve));
  });
}

async function renderSetup() {
  await act(async () => root.render(<ProfileSetup onSaved={onSaved} onCancel={vi.fn()} />));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.mocked(prepareProfileImage).mockImplementation(async (_file, role) => ({
    blob: new Blob([role], { type: "image/jpeg" }),
    metadata: { role, mime_type: "image/jpeg", width: 1536, height: 2048, byte_size: role.length, updated_at: "2026-08-16T00:00:00.000Z" },
  }));
  vi.mocked(generateProfileAssets).mockResolvedValue(roles.map((kind) => ({ kind, image_data_url: `data:image/jpeg;base64,${btoa(kind)}` })));
  vi.mocked(saveAsset).mockResolvedValue({} as never);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ProfileSetup", () => {
  it("asks for one clear full-body source photo", async () => {
    await renderSetup();

    expect(host.querySelectorAll('input[type="file"]')).toHaveLength(1);
    expect(host.textContent).toContain("One full-body photo");
    expect(host.textContent).toContain("white-background profile set");
    expect(host.textContent).not.toContain("Height (cm)");
  });

  it("requires explicit Google cloud consent before generation", async () => {
    await renderSetup();
    await act(async () => {
      choose();
    });
    await click("Generate profile photos");

    expect(generateProfileAssets).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Google Vertex AI");
  });

  it("previews all five generated images before saving them locally", async () => {
    await renderSetup();
    await act(async () => {
      choose();
      (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    });
    await click("Generate profile photos");

    await vi.waitFor(() => expect(generateProfileAssets).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(host.querySelectorAll(".generated-profile img")).toHaveLength(5));
    expect(host.textContent).toContain("AI-generated");
    expect(saveAsset).not.toHaveBeenCalled();

    await click("Save generated profile");
    expect(saveAsset).toHaveBeenCalledTimes(5);
    expect(roles.map((role, index) => vi.mocked(saveAsset).mock.calls[index][0].metadata.role)).toEqual([...roles]);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("does not save a partial profile when one generated image is invalid", async () => {
    vi.mocked(prepareProfileImage).mockImplementation(async (_file, role) => {
      if (role === "face_right") throw new Error("Generated face photo was invalid.");
      return { blob: new Blob([role]), metadata: { role, mime_type: "image/jpeg", width: 1536, height: 2048, byte_size: 1, updated_at: "2026-08-16T00:00:00.000Z" } };
    });
    await renderSetup();
    await act(async () => {
      choose();
      (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    });
    await click("Generate profile photos");

    await vi.waitFor(() => expect(host.textContent).toContain("Generated face photo was invalid."));
    expect(saveAsset).not.toHaveBeenCalled();
  });

  it("prevents duplicate generation while the request is running", async () => {
    let release!: (assets: Awaited<ReturnType<typeof generateProfileAssets>>) => void;
    vi.mocked(generateProfileAssets).mockReturnValue(new Promise((resolve) => { release = resolve; }));
    await renderSetup();
    await act(async () => {
      choose();
      (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    });
    const button = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    await act(async () => { button.click(); button.click(); await Promise.resolve(); });
    await vi.waitFor(() => expect(generateProfileAssets).toHaveBeenCalledOnce());
    expect(button.disabled).toBe(true);
    await act(async () => { release(roles.map((kind) => ({ kind, image_data_url: `data:image/jpeg;base64,${btoa(kind)}` }))); await new Promise((resolve) => setTimeout(resolve)); });
  });
});
