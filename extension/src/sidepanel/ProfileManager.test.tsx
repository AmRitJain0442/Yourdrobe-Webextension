import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareProfileImage } from "../profile/image";
import { assignLegacyImage, deleteAsset, deleteProfile, saveAsset, saveAttributes } from "../profile/store";
import type { ProfileMetadata } from "../profile/types";
import { ProfileManager } from "./ProfileManager";

vi.mock("../profile/store", () => ({
  assignLegacyImage: vi.fn(), deleteAsset: vi.fn(), deleteLegacyImage: vi.fn(), deleteProfile: vi.fn(), saveAsset: vi.fn(), saveAttributes: vi.fn(),
}));
vi.mock("../profile/image", () => ({ prepareProfileImage: vi.fn() }));

let root: Root;
let host: HTMLDivElement;
const profile: ProfileMetadata = {
  version: 2, consented_at: "2026-08-15T00:00:00.000Z", attributes: { height_cm: 165 },
  assets: { face_front: { role: "face_front", mime_type: "image/jpeg", width: 800, height: 800, byte_size: 10, updated_at: "2026-08-15T00:00:00.000Z" } },
};

async function renderManager(onChanged = vi.fn(), onClose = vi.fn()) {
  await act(async () => {
    root.render(<ProfileManager profile={profile} legacyImage="data:image/jpeg;base64,cGhvdG8=" onChanged={onChanged} onClose={onClose} />);
  });
  return { onChanged, onClose };
}

function choose(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  vi.mocked(assignLegacyImage).mockResolvedValue(profile);
  vi.mocked(deleteAsset).mockResolvedValue(profile);
  vi.mocked(deleteProfile).mockResolvedValue();
  vi.mocked(prepareProfileImage).mockImplementation(async (_file, role) => ({
    blob: new Blob([role], { type: "image/jpeg" }),
    metadata: { role, mime_type: "image/jpeg", width: 800, height: 800, byte_size: 1, updated_at: "2026-08-15T00:00:00.000Z" },
  }));
  vi.mocked(saveAsset).mockResolvedValue(profile);
  vi.mocked(saveAttributes).mockResolvedValue(profile);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("ProfileManager", () => {
  it("shows existing and legacy photos with category completion", async () => {
    await renderManager();
    expect(host.textContent).toContain("Front face photo");
    expect(host.textContent).toContain("Unclassified existing photo");
    expect(host.textContent).toContain("Makeup and face accessoriesComplete");
    expect(host.textContent).toContain("FootwearPhoto needed");
  });

  it("assigns the legacy image to the selected role", async () => {
    const { onChanged } = await renderManager();
    expect(host.textContent).toContain("browser-local profile storage and per-run transmission");
    expect(host.textContent).toContain("127.0.0.1:8001");
    const select = host.querySelector("select") as HTMLSelectElement;
    await act(async () => { select.value = "upper_body_front"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Assign photo")?.click(); });
    expect(assignLegacyImage).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Agree to browser-local storage and per-run transmission before assigning this photo.");
    await act(async () => { (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Assign photo")?.click(); });
    expect(assignLegacyImage).toHaveBeenCalledWith("upper_body_front");
    expect(onChanged).toHaveBeenCalled();
  });

  it("allows only one manager mutation and disables every mutating control", async () => {
    let releasePreparation!: (value: Awaited<ReturnType<typeof prepareProfileImage>>) => void;
    vi.mocked(prepareProfileImage).mockImplementationOnce(() => new Promise((resolve) => { releasePreparation = resolve; }));
    const { onChanged } = await renderManager();
    const replacement = host.querySelector('input[type="file"]') as HTMLInputElement;
    const deleteProfileButton = [...host.querySelectorAll("button")].find((button) => button.textContent === "Delete complete profile") as HTMLButtonElement;
    await act(async () => {
      choose(replacement, new File(["new"], "new.jpg", { type: "image/jpeg" }));
      await Promise.resolve();
    });
    const controlsWereDisabled = [...host.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")]
      .filter((control) => control.textContent !== "Close")
      .every((control) => control.matches(":disabled"));
    await act(async () => {
      choose(replacement, new File(["newer"], "newer.jpg", { type: "image/jpeg" }));
      deleteProfileButton.click();
    });
    await act(async () => {
      releasePreparation({ blob: new Blob(["new"], { type: "image/jpeg" }), metadata: { role: "face_front", mime_type: "image/jpeg", width: 800, height: 800, byte_size: 3, updated_at: "2026-08-15T00:00:00.000Z" } });
      await Promise.resolve();
    });

    expect(controlsWereDisabled).toBe(true);
    expect(prepareProfileImage).toHaveBeenCalledOnce();
    expect(saveAsset).toHaveBeenCalledOnce();
    expect(deleteProfile).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("deletes one asset only after confirmation", async () => {
    await renderManager();
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Delete photo")?.click(); });
    expect(deleteAsset).toHaveBeenCalledWith("face_front");
  });

  it("does not delete the complete profile when confirmation is cancelled", async () => {
    vi.mocked(globalThis.confirm).mockReturnValue(false);
    await renderManager();
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Delete complete profile")?.click(); });
    expect(deleteProfile).not.toHaveBeenCalled();
  });

  it("deletes the complete profile after confirmation", async () => {
    const { onChanged, onClose } = await renderManager();
    const height = [...host.querySelectorAll("input")].find((input) => input.getAttribute("name") === "height_cm") as HTMLInputElement;
    expect(height.value).toBe("165");
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Delete complete profile")?.click(); });
    expect(deleteProfile).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(height.value).toBe("");
  });

  it("saves numeric centimetre attributes from string inputs", async () => {
    await renderManager();
    const height = [...host.querySelectorAll("input")].find((input) => input.getAttribute("name") === "height_cm") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(height, "170"); height.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(height.validity.valid).toBe(true);
    expect((host.querySelector("form") as HTMLFormElement).checkValidity()).toBe(true);
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Save attributes")?.click(); });
    expect(saveAttributes).toHaveBeenCalledWith(expect.objectContaining({ height_cm: 170 }));
  });
});
