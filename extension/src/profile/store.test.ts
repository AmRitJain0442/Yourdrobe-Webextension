// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assignLegacyImage,
  deleteAsset,
  deleteLegacyImage,
  deleteProfile,
  loadLegacyImage,
  loadProfile,
  loadRequiredAssets,
  saveAsset,
  saveAttributes,
} from "./store";

let values: Record<string, unknown>;

beforeEach(async () => {
  values = {};
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("FileReader", class {
    result: string | null = null;
    error: Error | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type};base64,${btoa(String.fromCharCode(...new Uint8Array(buffer)))}`;
        this.onload?.();
      }, (error: Error) => {
        this.error = error;
        this.onerror?.();
      });
    }
  });
  globalThis.chrome = {
    storage: { local: {
      get: vi.fn(async (key: string) => ({ [key]: values[key] })),
      set: vi.fn(async (next: Record<string, unknown>) => { values = { ...values, ...next }; }),
      remove: vi.fn(async (key: string) => { delete values[key]; }),
    } },
  } as unknown as typeof chrome;
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 800, height: 800, close: vi.fn() }));
  await deleteProfile();
  vi.clearAllMocks();
});

const face = (blob = new Blob(["photo"], { type: "image/jpeg" })) => ({
  blob,
  metadata: { role: "face_front" as const, mime_type: "image/jpeg" as const, width: 800, height: 800, byte_size: blob.size, updated_at: "2026-08-15T00:00:00.000Z" },
});

describe("profile store", () => {
  it("stores a blob in IndexedDB and metadata in Chrome storage", async () => {
    await saveAsset(face());
    expect((await loadProfile())?.assets.face_front?.width).toBe(800);
    expect((await loadRequiredAssets(["face_front"]))[0]).toMatchObject({ kind: "face_front" });
  });

  it("does not remove a legacy image until assignment succeeds", async () => {
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({ yourdrobe_profile_image: "data:image/jpeg;base64,cGhvdG8=" }) as never);
    vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: 800, height: 960, close: vi.fn() } as never);
    expect(await loadLegacyImage()).toContain("data:image/jpeg");
    await assignLegacyImage("upper_body_front");
    expect(chrome.storage.local.remove).toHaveBeenCalledWith("yourdrobe_profile_image");
  });

  it("keeps a legacy image when assignment fails", async () => {
    await chrome.storage.local.set({ yourdrobe_profile_image: "data:image/jpeg;base64,cGhvdG8=" });
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error("invalid image"));

    await expect(assignLegacyImage("face_front")).rejects.toThrow("invalid image");
    expect(chrome.storage.local.remove).not.toHaveBeenCalledWith("yourdrobe_profile_image");
  });

  it("repairs metadata that points to a missing blob", async () => {
    await chrome.storage.local.set({ yourdrobe_profile_v2: {
      version: 2, consented_at: "2026-08-15T00:00:00.000Z", attributes: {},
      assets: { face_front: { role: "face_front", mime_type: "image/jpeg", width: 800, height: 800, byte_size: 5, updated_at: "2026-08-15T00:00:00.000Z" } },
    } });
    await expect(loadRequiredAssets(["face_front"])).rejects.toMatchObject({ role: "face_front" });
    expect((await loadProfile())?.assets.face_front).toBeUndefined();
  });

  it("restores the previous blob when metadata storage fails", async () => {
    await saveAsset(face(new Blob(["old"], { type: "image/jpeg" })));
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(saveAsset(face(new Blob(["new"], { type: "image/jpeg" })))).rejects.toThrow("storage unavailable");
    await expect(loadRequiredAssets(["face_front"])).resolves.toMatchObject([{ image_data_url: "data:image/jpeg;base64,b2xk" }]);
  });

  it("deletes one asset without removing the profile", async () => {
    await saveAsset(face());
    await deleteAsset("face_front");
    expect((await loadProfile())?.assets.face_front).toBeUndefined();
  });

  it("restores an asset when deleting its metadata fails", async () => {
    await saveAsset(face(new Blob(["old"], { type: "image/jpeg" })));
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(deleteAsset("face_front")).rejects.toThrow("storage unavailable");
    await expect(loadRequiredAssets(["face_front"])).resolves.toMatchObject([{ image_data_url: "data:image/jpeg;base64,b2xk" }]);
  });

  it("merges defined attributes and removes undefined attributes", async () => {
    await saveAttributes({ height_cm: 170, waist_cm: 70 });
    const result = await saveAttributes({ height_cm: undefined, top_size: "M" });
    expect(result.attributes).toEqual({ waist_cm: 70, top_size: "M" });
  });

  it("deletes a complete profile and its legacy image only when explicitly requested", async () => {
    await saveAsset(face());
    await chrome.storage.local.set({ yourdrobe_profile_image: "data:image/jpeg;base64,cGhvdG8=" });
    await deleteProfile();
    expect(await loadProfile()).toBeNull();
    expect(await loadLegacyImage()).toBeNull();
  });

  it("deletes the legacy image through its explicit path", async () => {
    await chrome.storage.local.set({ yourdrobe_profile_image: "data:image/jpeg;base64,cGhvdG8=" });
    await deleteLegacyImage();
    expect(await loadLegacyImage()).toBeNull();
  });
});
