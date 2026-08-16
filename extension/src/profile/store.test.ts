// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareProfileImage } from "./image";
import {
  assignLegacyImage,
  deleteActiveOutfit,
  deleteAsset,
  deleteLegacyImage,
  deleteProfile,
  loadActiveOutfit,
  loadLegacyImage,
  loadProfile,
  loadRequiredAssets,
  saveActiveOutfit,
  saveAsset,
  saveAttributes,
  saveYouCamConsent,
} from "./store";

let values: Record<string, unknown>;

function rawTransaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("yourdrobe_profile", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("assets", mode);
      const request = action(tx.objectStore("assets"));
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

const rawAsset = (role: string) => rawTransaction<Blob | undefined>("readonly", (store) => store.get(role));
const putRawAsset = (role: string, blob: Blob) => rawTransaction<IDBValidKey>("readwrite", (store) => store.put(blob, role));

const outfitInput = {
  job_id: "job-top", product_id: "product-top", product_title: "Blue top",
  product_type: "top" as const, product_url: "https://amazon.in/dp/TOP",
};

const outfitMetadata = () => ({
  version: 1 as const,
  ...outfitInput,
  mime_type: "image/jpeg" as const,
  byte_size: 6,
  saved_at: "2026-08-16T00:00:00.000Z",
});

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
      remove: vi.fn(async (key: string | string[]) => {
        for (const item of Array.isArray(key) ? key : [key]) delete values[item];
      }),
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

const feet = (blob = new Blob(["feet"], { type: "image/jpeg" })) => ({
  blob,
  metadata: { role: "feet_front" as const, mime_type: "image/jpeg" as const, width: 800, height: 800, byte_size: blob.size, updated_at: "2026-08-15T00:00:00.000Z" },
});

async function seedRawAsset(role: "face_front" | "feet_front", blob?: Blob) {
  const metadata = role === "face_front" ? face(blob).metadata : feet(blob).metadata;
  const current = await loadProfile();
  await chrome.storage.local.set({ yourdrobe_profile_v2: {
    version: 2, consented_at: "2026-08-15T00:00:00.000Z", attributes: {},
    assets: { ...current?.assets, [role]: metadata },
  } });
  if (blob) await putRawAsset(role, blob);
}

async function expectFeetPreserved() {
  expect((await loadProfile())?.assets.feet_front).toBeDefined();
  expect(await rawAsset("feet_front")).toBeDefined();
}

describe("profile store", () => {
  it("saves and loads one active outfit without persisting a provider URL", async () => {
    const providerResult = { ...outfitInput, result_url: "https://provider.example/render.jpg" };
    const saved = await saveActiveOutfit(new Blob(["render"], { type: "image/jpeg" }), providerResult);

    expect(saved.metadata).toMatchObject({ version: 1, job_id: "job-top", product_type: "top" });
    expect(saved.image_data_url).toBe("data:image/jpeg;base64,cmVuZGVy");
    expect(values.yourdrobe_active_outfit_v1).not.toHaveProperty("result_url");
  });

  it("atomically replaces and resets the active outfit", async () => {
    await saveActiveOutfit(new Blob(["old"], { type: "image/jpeg" }), outfitInput);
    await saveActiveOutfit(new Blob(["new"], { type: "image/png" }), { ...outfitInput, job_id: "job-new" });

    expect((await loadActiveOutfit())?.image_data_url).toBe("data:image/png;base64,bmV3");
    await deleteActiveOutfit();
    expect(await loadActiveOutfit()).toBeNull();
  });

  it.each([
    ["zero-byte", () => new Blob([], { type: "image/jpeg" })],
    ["non-image", () => new Blob(["render"], { type: "image/webp" })],
    ["10 MB", () => new Blob([new Uint8Array(10 * 1024 * 1024)], { type: "image/jpeg" })],
  ])("rejects a %s active outfit before persisting it", async (_label, createBlob) => {
    await expect(saveActiveOutfit(createBlob(), outfitInput)).rejects.toThrow();
    expect(values.yourdrobe_active_outfit_v1).toBeUndefined();
    expect(await rawAsset("active_outfit")).toBeUndefined();
  });

  it("rejects an undecodable active outfit before persisting it", async () => {
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error("decode failed"));

    await expect(saveActiveOutfit(new Blob(["broken"], { type: "image/jpeg" }), outfitInput)).rejects.toThrow("decode failed");
    expect(values.yourdrobe_active_outfit_v1).toBeUndefined();
    expect(await rawAsset("active_outfit")).toBeUndefined();
  });

  it("closes the decoded active-outfit bitmap", async () => {
    const close = vi.fn();
    vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: 800, height: 800, close } as never);

    await saveActiveOutfit(new Blob(["render"], { type: "image/jpeg" }), outfitInput);

    expect(close).toHaveBeenCalledOnce();
  });

  it("restores the previous active outfit when metadata storage fails", async () => {
    await saveActiveOutfit(new Blob(["old"], { type: "image/jpeg" }), outfitInput);
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(saveActiveOutfit(new Blob(["new"], { type: "image/png" }), { ...outfitInput, job_id: "job-new" })).rejects.toThrow("storage unavailable");
    await expect(loadActiveOutfit()).resolves.toMatchObject({
      metadata: { job_id: "job-top" },
      image_data_url: "data:image/jpeg;base64,b2xk",
    });
  });

  it("restores the active-outfit blob when metadata deletion fails", async () => {
    await saveActiveOutfit(new Blob(["render"], { type: "image/jpeg" }), outfitInput);
    vi.mocked(chrome.storage.local.remove).mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(deleteActiveOutfit()).rejects.toThrow("storage unavailable");
    await expect(loadActiveOutfit()).resolves.toMatchObject({ image_data_url: "data:image/jpeg;base64,cmVuZGVy" });
  });

  it("cleans active-outfit metadata that points to a missing blob", async () => {
    await chrome.storage.local.set({ yourdrobe_active_outfit_v1: outfitMetadata() });

    expect(await loadActiveOutfit()).toBeNull();
    expect(values.yourdrobe_active_outfit_v1).toBeUndefined();
    expect(await rawAsset("active_outfit")).toBeUndefined();
  });

  it.each([
    ["zero-byte", () => new Blob([], { type: "image/jpeg" })],
    ["non-image", () => new Blob(["render"], { type: "text/plain" })],
  ])("cleans a %s active-outfit blob and its metadata", async (_label, createBlob) => {
    await chrome.storage.local.set({ yourdrobe_active_outfit_v1: outfitMetadata() });
    await putRawAsset("active_outfit", createBlob());

    expect(await loadActiveOutfit()).toBeNull();
    expect(values.yourdrobe_active_outfit_v1).toBeUndefined();
    expect(await rawAsset("active_outfit")).toBeUndefined();
  });

  it("cleans an undecodable active-outfit blob and its metadata", async () => {
    await chrome.storage.local.set({ yourdrobe_active_outfit_v1: outfitMetadata() });
    await putRawAsset("active_outfit", new Blob(["broken"], { type: "image/jpeg" }));
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error("decode failed"));

    expect(await loadActiveOutfit()).toBeNull();
    expect(values.yourdrobe_active_outfit_v1).toBeUndefined();
    expect(await rawAsset("active_outfit")).toBeUndefined();
  });

  it("serializes an active-outfit save after complete-profile deletion", async () => {
    let entered!: () => void;
    let release!: () => void;
    const removalEntered = new Promise<void>((resolve) => { entered = resolve; });
    const removalReleased = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(chrome.storage.local.remove).mockImplementationOnce((async (key: string | string[]) => {
      entered();
      await removalReleased;
      for (const item of Array.isArray(key) ? key : [key]) delete values[item];
    }) as never);

    const deletion = deleteProfile();
    await removalEntered;
    let saving!: ReturnType<typeof saveActiveOutfit>;
    try {
      saving = saveActiveOutfit(new Blob(["render"], { type: "image/jpeg" }), outfitInput);
    } finally {
      release();
    }
    await Promise.all([deletion, saving]);

    await expect(loadActiveOutfit()).resolves.toMatchObject({ image_data_url: "data:image/jpeg;base64,cmVuZGVy" });
  });

  it("stores a blob in IndexedDB and metadata in Chrome storage", async () => {
    await saveAsset(face());
    expect((await loadProfile())?.assets.face_front?.width).toBe(800);
    expect((await loadRequiredAssets(["face_front"]))[0]).toMatchObject({ kind: "face_front" });
  });

  it("stores prepared images as plain blobs without source filenames", async () => {
    const prepared = await prepareProfileImage(new NodeFile(["photo"], "private-name.jpg", { type: "image/jpeg" }) as unknown as File, "face_front");
    expect("name" in prepared.blob).toBe(false);

    await saveAsset(prepared);

    expect("name" in (await rawAsset("face_front"))!).toBe(false);
  });

  it("replaces the raw IndexedDB blob for one role", async () => {
    await saveAsset(face(new Blob(["old"], { type: "image/jpeg" })));
    await saveAsset(face(new Blob(["new"], { type: "image/jpeg" })));

    expect(Buffer.from(await (await rawAsset("face_front"))!.arrayBuffer()).toString()).toBe("new");
  });

  it("does not remove a legacy image until assignment succeeds", async () => {
    vi.mocked(chrome.storage.local.get).mockImplementation(async () => ({ yourdrobe_profile_image: "data:image/jpeg;base64,cGhvdG8=" }) as never);
    vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: 800, height: 960, close: vi.fn() } as never);
    expect(await loadLegacyImage()).toContain("data:image/jpeg");
    await assignLegacyImage("upper_body_front");
    expect(chrome.storage.local.remove).toHaveBeenCalledWith("yourdrobe_profile_image");
    expect(chrome.storage.local.remove).toHaveBeenCalledTimes(1);
  });

  it("keeps a legacy image when assignment fails", async () => {
    await chrome.storage.local.set({ yourdrobe_profile_image: "data:image/jpeg;base64,cGhvdG8=" });
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error("invalid image"));

    await expect(assignLegacyImage("face_front")).rejects.toThrow("invalid image");
    expect(chrome.storage.local.remove).not.toHaveBeenCalledWith("yourdrobe_profile_image");
  });

  it("keeps a legacy image when saving its assigned asset fails", async () => {
    await chrome.storage.local.set({ yourdrobe_profile_image: "data:image/jpeg;base64,cGhvdG8=" });
    vi.clearAllMocks();
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(assignLegacyImage("face_front")).rejects.toThrow("storage unavailable");
    expect(await loadLegacyImage()).toContain("data:image/jpeg");
    expect(chrome.storage.local.remove).not.toHaveBeenCalledWith("yourdrobe_profile_image");
  });

  it("repairs metadata that points to a missing blob", async () => {
    await seedRawAsset("face_front");
    await seedRawAsset("feet_front", new Blob(["feet"], { type: "image/jpeg" }));
    await expect(loadRequiredAssets(["face_front"])).rejects.toMatchObject({ role: "face_front" });
    expect((await loadProfile())?.assets.face_front).toBeUndefined();
    expect(await rawAsset("face_front")).toBeUndefined();
    await expectFeetPreserved();
  });

  it.each([
    ["zero-byte", () => new Blob([], { type: "image/jpeg" })],
    ["non-image", () => new Blob(["not an image"], { type: "text/plain" })],
  ])("repairs a %s raw blob", async (_label, createBlob) => {
    await seedRawAsset("face_front", createBlob());
    await seedRawAsset("feet_front", new Blob(["feet"], { type: "image/jpeg" }));

    await expect(loadRequiredAssets(["face_front"])).rejects.toMatchObject({ role: "face_front" });
    expect((await loadProfile())?.assets.face_front).toBeUndefined();
    expect(await rawAsset("face_front")).toBeUndefined();
    await expectFeetPreserved();
  });

  it("repairs an image blob that cannot be decoded", async () => {
    await seedRawAsset("face_front", new Blob(["broken"], { type: "image/jpeg" }));
    await seedRawAsset("feet_front", new Blob(["feet"], { type: "image/jpeg" }));
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error("decode failed"));

    await expect(loadRequiredAssets(["face_front"])).rejects.toMatchObject({ role: "face_front" });
    expect((await loadProfile())?.assets.face_front).toBeUndefined();
    expect(await rawAsset("face_front")).toBeUndefined();
    await expectFeetPreserved();
  });

  it("keeps a valid image and metadata when FileReader fails", async () => {
    const close = vi.fn();
    await seedRawAsset("face_front", new Blob(["photo"], { type: "image/jpeg" }));
    await seedRawAsset("feet_front", new Blob(["feet"], { type: "image/jpeg" }));
    vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: 800, height: 800, close } as never);
    vi.stubGlobal("FileReader", class {
      result = null;
      error = new Error("read failed");
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL() { this.onerror?.(); }
    });

    await expect(loadRequiredAssets(["face_front"])).rejects.toThrow("read failed");
    expect(close).toHaveBeenCalledOnce();
    expect((await loadProfile())?.assets.face_front).toBeDefined();
    expect(await rawAsset("face_front")).toBeDefined();
    await expectFeetPreserved();
  });

  it("restores the previous blob when metadata storage fails", async () => {
    await saveAsset(face(new Blob(["old"], { type: "image/jpeg" })));
    vi.mocked(chrome.storage.local.set).mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(saveAsset(face(new Blob(["new"], { type: "image/jpeg" })))).rejects.toThrow("storage unavailable");
    await expect(loadRequiredAssets(["face_front"])).resolves.toMatchObject([{ image_data_url: "data:image/jpeg;base64,b2xk" }]);
  });

  it("deletes one asset without removing the profile", async () => {
    await saveAsset(face());
    await saveAsset(feet());
    await deleteAsset("face_front");
    expect((await loadProfile())?.assets.face_front).toBeUndefined();
    expect((await loadProfile())?.assets.feet_front).toBeDefined();
    expect(await rawAsset("face_front")).toBeUndefined();
    expect(await rawAsset("feet_front")).toBeDefined();
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

  it("records separate YouCam consent only on an existing profile", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T00:00:00.000Z"));
    try {
      await saveAttributes({ top_size: "M" });
      const result = await saveYouCamConsent();
      expect(result.youcam_consented_at).toBe("2026-08-16T00:00:00.000Z");
      expect((await loadProfile())?.youcam_consented_at).toBe("2026-08-16T00:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not manufacture a profile while recording YouCam consent", async () => {
    await expect(saveYouCamConsent()).rejects.toThrow("Create your local profile first.");
    expect(await loadProfile()).toBeNull();
  });

  it("converts stored WebP to JPEG only for a provider upload", async () => {
    await saveAsset(face(new Blob(["webp"], { type: "image/webp" })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback?.(new Blob(["jpeg"], { type: "image/jpeg" })));

    const uploads = await loadRequiredAssets(["face_front"]);

    expect(uploads[0].image_data_url).toBe("data:image/jpeg;base64,anBlZw==");
    expect((await rawAsset("face_front"))?.type).toBe("image/webp");
  });

  it("keeps a valid WebP and metadata when transient conversion fails", async () => {
    await saveAsset(face(new Blob(["webp"], { type: "image/webp" })));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);

    await expect(loadRequiredAssets(["face_front"])).rejects.toThrow("We could not process that image.");
    expect((await loadProfile())?.assets.face_front).toBeDefined();
    expect((await rawAsset("face_front"))?.type).toBe("image/webp");
  });

  it("serializes concurrent saves so neither metadata entry is lost", async () => {
    let reads = 0;
    vi.mocked(chrome.storage.local.get).mockImplementation((async (key: string) => {
      const snapshot = { [key]: values[key] };
      if (reads++ === 0) await Promise.resolve();
      return snapshot;
    }) as never);

    await Promise.all([saveAsset(face()), saveAsset(feet())]);

    expect((await loadProfile())?.assets).toMatchObject({ face_front: face().metadata, feet_front: feet().metadata });
    expect(await rawAsset("face_front")).toBeDefined();
    expect(await rawAsset("feet_front")).toBeDefined();
  });

  it("serializes attribute and asset saves so neither update is lost", async () => {
    let reads = 0;
    vi.mocked(chrome.storage.local.get).mockImplementation((async (key: string) => {
      const snapshot = { [key]: values[key] };
      if (reads++ === 0) await Promise.resolve();
      return snapshot;
    }) as never);

    await Promise.all([saveAsset(face()), saveAttributes({ height_cm: 170 })]);

    expect((await loadProfile())?.assets.face_front).toBeDefined();
    expect((await loadProfile())?.attributes.height_cm).toBe(170);
    expect(await rawAsset("face_front")).toBeDefined();
  });

  it("serializes a deletion before a later save", async () => {
    await saveAsset(face());
    let entered!: () => void;
    let release!: () => void;
    const writeEntered = new Promise<void>((resolve) => { entered = resolve; });
    const writeReleased = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(chrome.storage.local.set).mockImplementationOnce(async (next: Record<string, unknown>) => {
      entered();
      await writeReleased;
      values = { ...values, ...next };
    }).mockImplementation(async (next: Record<string, unknown>) => { values = { ...values, ...next }; });

    const deletion = deleteAsset("face_front");
    await writeEntered;
    const saving = saveAsset(feet());
    release();
    await Promise.all([deletion, saving]);

    expect((await loadProfile())?.assets.face_front).toBeUndefined();
    expect((await loadProfile())?.assets.feet_front).toBeDefined();
    expect(await rawAsset("face_front")).toBeUndefined();
    expect(await rawAsset("feet_front")).toBeDefined();
  });

  it("does not resurrect stale metadata when a save starts during complete deletion", async () => {
    await saveAsset(face());
    await saveAttributes({ height_cm: 170 });
    let entered!: () => void;
    let release!: () => void;
    const removalEntered = new Promise<void>((resolve) => { entered = resolve; });
    const removalReleased = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(chrome.storage.local.remove).mockImplementationOnce((async (key: string | string[]) => {
      entered();
      await removalReleased;
      for (const item of Array.isArray(key) ? key : [key]) delete values[item];
    }) as never);

    const deletion = deleteProfile();
    await removalEntered;
    const saving = saveAsset(feet());
    release();
    await Promise.all([deletion, saving]);

    expect((await loadProfile())?.assets.face_front).toBeUndefined();
    expect((await loadProfile())?.assets.feet_front).toBeDefined();
    expect((await loadProfile())?.attributes).toEqual({});
    expect(await rawAsset("face_front")).toBeUndefined();
    expect(await rawAsset("feet_front")).toBeDefined();
  });

  it("deletes a complete profile and its legacy image only when explicitly requested", async () => {
    await saveAsset(face());
    await saveAsset(feet());
    await saveActiveOutfit(new Blob(["render"], { type: "image/jpeg" }), outfitInput);
    await chrome.storage.local.set({ yourdrobe_profile_image: "data:image/jpeg;base64,cGhvdG8=" });
    vi.clearAllMocks();
    await deleteProfile();
    expect(await loadProfile()).toBeNull();
    expect(await loadActiveOutfit()).toBeNull();
    expect(await loadLegacyImage()).toBeNull();
    expect(await rawAsset("face_front")).toBeUndefined();
    expect(await rawAsset("feet_front")).toBeUndefined();
    expect(await rawAsset("active_outfit")).toBeUndefined();
    expect(chrome.storage.local.remove).toHaveBeenCalledOnce();
    expect(chrome.storage.local.remove).toHaveBeenCalledWith(["yourdrobe_profile_v2", "yourdrobe_profile_image", "yourdrobe_active_outfit_v1"]);
  });

  it("deletes the legacy image through its explicit path", async () => {
    await chrome.storage.local.set({ yourdrobe_profile_image: "data:image/jpeg;base64,cGhvdG8=" });
    await deleteLegacyImage();
    expect(await loadLegacyImage()).toBeNull();
  });
});
