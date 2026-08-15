import { prepareProfileImage } from "./image";
import type { PhotoRole, PreparedProfileImage, ProfileAssetUpload, ProfileAttributes, ProfileMetadata } from "./types";

const databaseName = "yourdrobe_profile";
const objectStoreName = "assets";
const metadataKey = "yourdrobe_profile_v2";
const legacyKey = "yourdrobe_profile_image";

let database: Promise<IDBDatabase> | undefined;

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

export async function saveAsset(image: PreparedProfileImage): Promise<ProfileMetadata> {
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

export async function loadRequiredAssets(roles: PhotoRole[]): Promise<ProfileAssetUpload[]> {
  const profile = await loadProfile();
  if (!profile) return [];
  const uploads: ProfileAssetUpload[] = [];
  for (const role of roles) {
    if (!profile.assets[role]) continue;
    const blob = await transaction<Blob | undefined>("readonly", (store) => store.get(role));
    if (!blob) {
      const assets = { ...profile.assets };
      delete assets[role];
      await saveMetadata({ ...profile, assets });
      throw new LocalProfileAssetMissingError(role);
    }
    uploads.push({ kind: role, image_data_url: await dataUrl(blob) });
  }
  return uploads;
}

export async function deleteAsset(role: PhotoRole): Promise<ProfileMetadata | null> {
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
}

export async function saveAttributes(attributes: ProfileAttributes): Promise<ProfileMetadata> {
  const profile = await loadProfile() ?? emptyProfile();
  const nextAttributes = { ...profile.attributes };
  for (const [key, value] of Object.entries(attributes) as [keyof ProfileAttributes, ProfileAttributes[keyof ProfileAttributes]][]) {
    if (value === undefined) delete nextAttributes[key];
    else (nextAttributes as Record<string, unknown>)[key] = value;
  }
  const next = { ...profile, attributes: nextAttributes };
  await saveMetadata(next);
  return next;
}

export async function deleteProfile(): Promise<void> {
  await transaction("readwrite", (store) => store.clear());
  await chrome.storage.local.remove(metadataKey);
  await chrome.storage.local.remove(legacyKey);
}

export async function loadLegacyImage(): Promise<string | null> {
  const value = await chrome.storage.local.get(legacyKey);
  return typeof value[legacyKey] === "string" ? value[legacyKey] : null;
}

export async function assignLegacyImage(role: PhotoRole): Promise<ProfileMetadata> {
  const image = await loadLegacyImage();
  if (!image) throw new Error("No legacy image is available.");
  const blob = dataUrlBlob(image);
  const prepared = await prepareProfileImage(new File([blob], "legacy-image", { type: blob.type }), role);
  const profile = await saveAsset(prepared);
  await chrome.storage.local.remove(legacyKey);
  return profile;
}

export async function deleteLegacyImage(): Promise<void> {
  await chrome.storage.local.remove(legacyKey);
}
