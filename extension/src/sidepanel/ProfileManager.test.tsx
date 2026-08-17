import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assignLegacyImage, deleteAsset, deleteProfile } from "../profile/store";
import type { ProfileMetadata } from "../profile/types";
import { ProfileManager } from "./ProfileManager";

vi.mock("../profile/store", () => ({
  assignLegacyImage: vi.fn(), deleteAsset: vi.fn(), deleteLegacyImage: vi.fn(), deleteProfile: vi.fn(), saveAsset: vi.fn(),
}));

let root: Root;
let host: HTMLDivElement;
const profile: ProfileMetadata = {
  version: 2, consented_at: "2026-08-15T00:00:00.000Z", attributes: { height_cm: 165 },
  assets: { face_front: { role: "face_front", mime_type: "image/jpeg", width: 800, height: 800, byte_size: 10, updated_at: "2026-08-15T00:00:00.000Z" } },
};

async function renderManager(
  onChanged = vi.fn(),
  onClose = vi.fn(),
  currentProfile: ProfileMetadata | null = profile,
  legacyImage: string | null = "data:image/jpeg;base64,cGhvdG8=",
) {
  await act(async () => {
    root.render(<ProfileManager profile={currentProfile} legacyImage={legacyImage} onChanged={onChanged} onClose={onClose} />);
  });
  return { onChanged, onClose };
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  vi.mocked(assignLegacyImage).mockResolvedValue(profile);
  vi.mocked(deleteAsset).mockResolvedValue(profile);
  vi.mocked(deleteProfile).mockResolvedValue();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("ProfileManager", () => {
  it("manages only the five required photos without measurement fields", async () => {
    await renderManager();

    expect(host.querySelectorAll(".profile-asset:not(.legacy-image)")).toHaveLength(5);
    expect(host.textContent).toContain("Front face photo");
    expect(host.textContent).toContain("Left face photo");
    expect(host.textContent).toContain("Right face photo");
    expect(host.textContent).toContain("Front full-body photo");
    expect(host.textContent).toContain("Side full-body photo");
    expect(host.textContent).not.toContain("Optional attributes");
    expect(host.querySelector('input[name="height_cm"]')).toBeNull();
    expect(host.querySelector('input[type="file"]')).toBeNull();
    expect(host.textContent).toContain("Replace from one full-body photo");
  });

  it("shows existing and legacy photos with profile completion", async () => {
    await renderManager();
    expect(host.textContent).toContain("Front face photo");
    expect(host.textContent).toContain("Unclassified existing photo");
    expect(host.textContent).toContain("1 of 5 required photos saved");
  });

  it("opens the same one-photo generation flow for replacement", async () => {
    await renderManager(vi.fn(), vi.fn(), profile, null);
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Replace from one full-body photo")?.click(); });

    expect(host.textContent).toContain("Create your profile from one photo");
    expect(host.querySelectorAll('input[type="file"]')).toHaveLength(1);
  });

  it("assigns the legacy image to the selected role", async () => {
    const { onChanged } = await renderManager();
    expect(host.textContent).toContain("browser-local profile storage and per-run transmission");
    expect(host.textContent).toContain("Yourdrobe cloud service and its AI processing providers");
    const select = host.querySelector("select") as HTMLSelectElement;
    await act(async () => { select.value = "full_body_side"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Assign photo")?.click(); });
    expect(assignLegacyImage).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Agree to browser-local storage and per-run transmission before assigning this photo.");
    await act(async () => { (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Assign photo")?.click(); });
    expect(assignLegacyImage).toHaveBeenCalledWith("full_body_side");
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
    const { onChanged, onClose } = await renderManager();
    await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === "Delete complete profile")?.click(); });
    expect(deleteProfile).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
