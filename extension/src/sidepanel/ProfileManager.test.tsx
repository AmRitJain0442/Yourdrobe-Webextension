import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assignLegacyImage, deleteAsset, deleteProfile, saveAttributes } from "../profile/store";
import type { ProfileMetadata } from "../profile/types";
import { ProfileManager } from "./ProfileManager";

vi.mock("../profile/store", () => ({
  assignLegacyImage: vi.fn(), deleteAsset: vi.fn(), deleteLegacyImage: vi.fn(), deleteProfile: vi.fn(), saveAsset: vi.fn(), saveAttributes: vi.fn(),
}));
vi.mock("../profile/image", () => ({ prepareProfileImage: vi.fn() }));

let root: Root;
let host: HTMLDivElement;
const profile: ProfileMetadata = {
  version: 2, consented_at: "2026-08-15T00:00:00.000Z", attributes: {},
  assets: { face_front: { role: "face_front", mime_type: "image/jpeg", width: 800, height: 800, byte_size: 10, updated_at: "2026-08-15T00:00:00.000Z" } },
};

async function renderManager(onChanged = vi.fn()) {
  await act(async () => {
    root.render(<ProfileManager profile={profile} legacyImage="data:image/jpeg;base64,cGhvdG8=" onChanged={onChanged} onClose={vi.fn()} />);
  });
  return onChanged;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  vi.mocked(assignLegacyImage).mockResolvedValue(profile);
  vi.mocked(deleteAsset).mockResolvedValue(profile);
  vi.mocked(deleteProfile).mockResolvedValue();
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
    const onChanged = await renderManager();
    const select = host.querySelector("select") as HTMLSelectElement;
    await act(async () => { select.value = "upper_body_front"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Assign photo")?.click(); });
    expect(assignLegacyImage).toHaveBeenCalledWith("upper_body_front");
    expect(onChanged).toHaveBeenCalled();
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
    const onChanged = await renderManager();
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Delete complete profile")?.click(); });
    expect(deleteProfile).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("saves numeric centimetre attributes from string inputs", async () => {
    await renderManager();
    const height = [...host.querySelectorAll("input")].find((input) => input.getAttribute("name") === "height_cm") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(height, "170"); height.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { host.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(saveAttributes).toHaveBeenCalledWith(expect.objectContaining({ height_cm: 170 }));
  });
});
