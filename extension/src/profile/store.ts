import type { ProductType } from "../types";
import { prepareProfileImage } from "./image";
import type { ActiveOutfit, ActiveOutfitInput, ActiveOutfitMetadata, OutfitItem, PhotoRole, PreparedProfileImage, ProfileAssetUpload, ProfileAttributes, ProfileMetadata } from "./types";

const databaseName = "yourdrobe_profile";
const objectStoreName = "assets";
const metadataKey = "yourdrobe_profile_v2";
const legacyKey = "yourdrobe_profile_image";
const activeOutfitBlobKey = "active_outfit";
const activeOutfitMetadataKey = "yourdrobe_active_outfit_v1";
const outfitItemsKey = "yourdrobe_outfit_items_v1";
const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const acceptedActiveOutfitTypes = new Set(["image/jpeg", "image/png"]);
const acceptedProductTypes = new Set<ProductType>([
  "makeup", "eyewear", "headwear", "earrings", "necklace", "top", "outerwear", "dress", "bottom",
  "belt", "bag", "watch", "bracelet", "ring", "footwear", "unknown",
]);
const maxActiveOutfitBytes = 10 * 1024 * 1024;
const platformHosts: Record<OutfitItem["platform"], string> = {
  amazon_in: "amazon.in", amazon_us: "amazon.com", flipkart: "flipkart.com", nykaa: "nykaa.com",
};

let database: Promise<IDBDatabase> | undefined;
let profileOperations: Promise<void> = Promise.resolve();

function withProfileLock<T>(operation: () => Promise<T>): Promise<T> {
  // ponytail: one profile-wide lock; split per role only if local mutation throughput matters.
  const result = profileOperations.then(operation, operation);
  profileOperations = result.then(() => undefined, () => undefined);
  return result;
}

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(objectStoreName)) request.result.createObjectStore(objectStoreName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(objectStoreName, mode);
    const request = action(tx.objectStore(objectStoreName));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => { /* transaction completion is the commit point */ };
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function emptyProfile(): ProfileMetadata {
  return { version: 2, consented_at: new Date().toISOString(), assets: {}, attributes: {} };
}

async function saveMetadata(profile: ProfileMetadata): Promise<void> {
  await chrome.storage.local.set({ [metadataKey]: profile });
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("We could not process that image."));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlBlob(data: string): Blob {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(data);
  if (!match) throw new Error("We could not process that image.");
  const [, type = "application/octet-stream", base64, body] = match;
  if (!base64) return new Blob([decodeURIComponent(body)], { type });
  const decoded = atob(body);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type });
}

async function validateActiveOutfitBlob(blob: Blob): Promise<void> {
  if (!blob.size) throw new Error("Choose a non-empty image.");
  if (!acceptedActiveOutfitTypes.has(blob.type)) throw new Error("Use a JPEG or PNG image.");
  if (blob.size >= maxActiveOutfitBytes) throw new Error("Choose an image smaller than 10 MB.");
  const bitmap = await createImageBitmap(blob);
  try {
    return;
  } finally {
    bitmap.close();
  }
}

function isActiveOutfitMetadata(value: unknown): value is ActiveOutfitMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Record<string, unknown>;
  return Object.keys(metadata).length === 9
    && metadata.version === 1
    && typeof metadata.job_id === "string"
    && typeof metadata.product_id === "string"
    && typeof metadata.product_title === "string"
    && acceptedProductTypes.has(metadata.product_type as ProductType)
    && typeof metadata.product_url === "string"
    && acceptedActiveOutfitTypes.has(metadata.mime_type as string)
    && Number.isSafeInteger(metadata.byte_size) && (metadata.byte_size as number) > 0
    && typeof metadata.saved_at === "string";
}

function isOutfitItem(value: unknown): value is OutfitItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).length !== 5 || typeof item.platform !== "string" || !(item.platform in platformHosts)
    || typeof item.title !== "string" || !item.title.trim() || item.title.length > 300
    || !acceptedProductTypes.has(item.product_type as ProductType)
    || typeof item.product_url !== "string" || typeof item.image_url !== "string") return false;
  try {
    const productUrl = new URL(item.product_url);
    return productUrl.protocol === "https:"
      && productUrl.hostname.toLowerCase().replace(/^www\./, "") === platformHosts[item.platform as OutfitItem["platform"]]
      && (!item.image_url || new URL(item.image_url).protocol === "https:");
  } catch {
    return false;
  }
}

async function removeActiveOutfit(previousBlob?: Blob): Promise<void> {
  await transaction("readwrite", (store) => store.delete(activeOutfitBlobKey));
  try {
    await chrome.storage.local.remove([activeOutfitMetadataKey, outfitItemsKey]);
  } catch (error) {
    if (previousBlob) await transaction("readwrite", (store) => store.put(previousBlob, activeOutfitBlobKey));
    throw error;
  }
}

export class LocalProfileAssetMissingError extends Error {
  constructor(readonly role: PhotoRole) {
    super(`The local ${role} image is missing.`);
    this.name = "LocalProfileAssetMissingError";
  }
}

export async function loadProfile(): Promise<ProfileMetadata | null> {
  const value = await chrome.storage.local.get(metadataKey);
  return (value[metadataKey] as ProfileMetadata | undefined) ?? null;
}

export function saveActiveOutfit(blob: Blob, input: ActiveOutfitInput): Promise<ActiveOutfit> {
  return withProfileLock(async () => {
    await validateActiveOutfitBlob(blob);
    const image_data_url = await dataUrl(blob);
    const previousBlob = await transaction<Blob | undefined>("readonly", (store) => store.get(activeOutfitBlobKey));
    const metadata: ActiveOutfitMetadata = {
      version: 1,
      job_id: input.job_id,
      product_id: input.product_id,
      product_title: input.product_title,
      product_type: input.product_type,
      product_url: input.product_url,
      mime_type: blob.type as ActiveOutfitMetadata["mime_type"],
      byte_size: blob.size,
      saved_at: new Date().toISOString(),
    };
    await transaction("readwrite", (store) => store.put(blob, activeOutfitBlobKey));
    try {
      await chrome.storage.local.set({ [activeOutfitMetadataKey]: metadata });
    } catch (error) {
      if (previousBlob) await transaction("readwrite", (store) => store.put(previousBlob, activeOutfitBlobKey));
      else await transaction("readwrite", (store) => store.delete(activeOutfitBlobKey));
      throw error;
    }
    return { metadata, image_data_url };
  });
}

export function loadActiveOutfit(): Promise<ActiveOutfit | null> {
  return withProfileLock(async () => {
    const value = await chrome.storage.local.get(activeOutfitMetadataKey);
    const metadata = value[activeOutfitMetadataKey];
    const blob = await transaction<Blob | undefined>("readonly", (store) => store.get(activeOutfitBlobKey));
    if (!isActiveOutfitMetadata(metadata) || !blob) {
      if (metadata !== undefined || blob) await removeActiveOutfit(blob);
      return null;
    }
    // ponytail: separate stores cannot detect an interrupted same-MIME, same-size replacement;
    // add a content digest or generation to the approved metadata contract if exact crash recovery is required.
    if (metadata.mime_type !== blob.type || metadata.byte_size !== blob.size) {
      await removeActiveOutfit(blob);
      return null;
    }
    try {
      await validateActiveOutfitBlob(blob);
    } catch {
      await removeActiveOutfit(blob);
      return null;
    }
    return { metadata, image_data_url: await dataUrl(blob) };
  });
}

export function deleteActiveOutfit(): Promise<void> {
  return withProfileLock(async () => {
    const previousBlob = await transaction<Blob | undefined>("readonly", (store) => store.get(activeOutfitBlobKey));
    await removeActiveOutfit(previousBlob);
  });
}

export async function loadOutfitItems(): Promise<OutfitItem[]> {
  const value = await chrome.storage.local.get(outfitItemsKey);
  const items = value[outfitItemsKey];
  if (items === undefined) {
    const activeValue = await chrome.storage.local.get(activeOutfitMetadataKey);
    const metadata = activeValue[activeOutfitMetadataKey];
    if (!isActiveOutfitMetadata(metadata)) return [];
    let platform: OutfitItem["platform"] | undefined;
    try {
      const host = new URL(metadata.product_url).hostname.toLowerCase().replace(/^www\./, "");
      platform = (Object.entries(platformHosts) as [OutfitItem["platform"], string][]).find(([, expected]) => host === expected)?.[0];
    } catch { /* invalid legacy URLs are handled by active-outfit validation */ }
    return platform ? [{ platform, title: metadata.product_title, product_type: metadata.product_type, product_url: metadata.product_url, image_url: "" }] : [];
  }
  if (!Array.isArray(items) || items.length > 20 || !items.every(isOutfitItem)) {
    await chrome.storage.local.remove(outfitItemsKey);
    return [];
  }
  return items.map((item) => ({ ...item }));
}

export function saveOutfitItem(input: OutfitItem): Promise<OutfitItem[]> {
  return withProfileLock(async () => {
    if (!isOutfitItem(input)) throw new Error("Choose a product from a supported retailer.");
    const current = await loadOutfitItems();
    const item = { ...input, title: input.title.trim() };
    const next = [...current.filter((saved) => saved.product_type !== item.product_type), item].slice(-20);
    await chrome.storage.local.set({ [outfitItemsKey]: next });
    return next;
  });
}

export function removeOutfitItem(productUrl: string): Promise<OutfitItem[]> {
  return withProfileLock(async () => {
    const next = (await loadOutfitItems()).filter((item) => item.product_url !== productUrl);
    await chrome.storage.local.set({ [outfitItemsKey]: next });
    return next;
  });
}

async function saveAssetUnlocked(image: PreparedProfileImage): Promise<ProfileMetadata> {
  const profile = await loadProfile() ?? emptyProfile();
  const previousBlob = await transaction<Blob | undefined>("readonly", (store) => store.get(image.metadata.role));
  const next: ProfileMetadata = {
    ...profile,
    assets: { ...profile.assets, [image.metadata.role]: image.metadata },
  };
  await transaction("readwrite", (store) => store.put(image.blob, image.metadata.role));
  try {
    await saveMetadata(next);
  } catch (error) {
    if (previousBlob) await transaction("readwrite", (store) => store.put(previousBlob, image.metadata.role));
    else await transaction("readwrite", (store) => store.delete(image.metadata.role));
    throw error;
  }
  return next;
}

export function saveAsset(image: PreparedProfileImage): Promise<ProfileMetadata> {
  return withProfileLock(() => saveAssetUnlocked(image));
}

async function removeCorruptAsset(profile: ProfileMetadata, role: PhotoRole, previousBlob?: Blob): Promise<never> {
  await transaction("readwrite", (store) => store.delete(role));
  const assets = { ...profile.assets };
  delete assets[role];
  try {
    await saveMetadata({ ...profile, assets });
  } catch (error) {
    if (previousBlob) await transaction("readwrite", (store) => store.put(previousBlob, role));
    throw error;
  }
  throw new LocalProfileAssetMissingError(role);
}

export function loadRequiredAssets(roles: PhotoRole[]): Promise<ProfileAssetUpload[]> {
  return withProfileLock(async () => {
    const profile = await loadProfile();
    if (!profile) return [];
    const uploads: ProfileAssetUpload[] = [];
    for (const role of roles) {
      if (!profile.assets[role]) continue;
      const blob = await transaction<Blob | undefined>("readonly", (store) => store.get(role));
      if (!blob) return removeCorruptAsset(profile, role);
      if (!blob.size || !acceptedImageTypes.has(blob.type)) return removeCorruptAsset(profile, role, blob);
      let bitmap: ImageBitmap | undefined;
      try {
        bitmap = await createImageBitmap(blob);
      } catch {
        return removeCorruptAsset(profile, role, blob);
      }
      try {
        let uploadBlob = blob;
        if (blob.type === "image/webp") {
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("We could not process that image.");
          context.drawImage(bitmap, 0, 0);
          uploadBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((jpeg) => jpeg ? resolve(jpeg) : reject(new Error("We could not process that image.")), "image/jpeg", 0.9));
        }
        uploads.push({ kind: role, image_data_url: await dataUrl(uploadBlob) });
      } finally {
        bitmap?.close();
      }
    }
    return uploads;
  });
}

export function deleteAsset(role: PhotoRole): Promise<ProfileMetadata | null> {
  return withProfileLock(async () => {
    const profile = await loadProfile();
    const previousBlob = await transaction<Blob | undefined>("readonly", (store) => store.get(role));
    await transaction("readwrite", (store) => store.delete(role));
    if (!profile) return null;
    const assets = { ...profile.assets };
    delete assets[role];
    const next = { ...profile, assets };
    try {
      await saveMetadata(next);
    } catch (error) {
      if (previousBlob) await transaction("readwrite", (store) => store.put(previousBlob, role));
      throw error;
    }
    return next;
  });
}

export function saveAttributes(attributes: ProfileAttributes): Promise<ProfileMetadata> {
  return withProfileLock(async () => {
    const profile = await loadProfile() ?? emptyProfile();
    const nextAttributes = { ...profile.attributes };
    for (const [key, value] of Object.entries(attributes) as [keyof ProfileAttributes, ProfileAttributes[keyof ProfileAttributes]][]) {
      if (value === undefined) delete nextAttributes[key];
      else (nextAttributes as Record<string, unknown>)[key] = value;
    }
    const next = { ...profile, attributes: nextAttributes };
    await saveMetadata(next);
    return next;
  });
}

export function saveYouCamConsent(): Promise<ProfileMetadata> {
  return withProfileLock(async () => {
    const profile = await loadProfile();
    if (!profile) throw new Error("Create your local profile first.");
    const next = { ...profile, youcam_consented_at: new Date().toISOString() };
    await saveMetadata(next);
    return next;
  });
}

export function deleteProfile(): Promise<void> {
  return withProfileLock(async () => {
    await transaction("readwrite", (store) => store.clear());
    await chrome.storage.local.remove([metadataKey, legacyKey, activeOutfitMetadataKey, outfitItemsKey]);
  });
}

export async function loadLegacyImage(): Promise<string | null> {
  const value = await chrome.storage.local.get(legacyKey);
  return typeof value[legacyKey] === "string" ? value[legacyKey] : null;
}

export function assignLegacyImage(role: PhotoRole): Promise<ProfileMetadata> {
  return withProfileLock(async () => {
    const image = await loadLegacyImage();
    if (!image) throw new Error("No legacy image is available.");
    const blob = dataUrlBlob(image);
    const prepared = await prepareProfileImage(new File([blob], "legacy-image", { type: blob.type }), role);
    const profile = await saveAssetUnlocked(prepared);
    await chrome.storage.local.remove(legacyKey);
    return profile;
  });
}

export function deleteLegacyImage(): Promise<void> {
  return withProfileLock(async () => {
    await chrome.storage.local.remove(legacyKey);
  });
}
