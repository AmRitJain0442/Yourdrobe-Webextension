import type { PhotoRole, PreparedProfileImage } from "./types";

const accepted = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxSourceBytes = 10 * 1024 * 1024;
const targetBytes = 2 * 1024 * 1024;
const minimum: Record<PhotoRole, readonly [number, number]> = {
  face_front: [720, 720], face_left: [720, 720], face_right: [720, 720],
  upper_body_front: [720, 960], upper_body_side: [720, 960],
  full_body_front: [720, 1280], full_body_side: [720, 1280],
  left_hand_wrist: [720, 720], right_hand_wrist: [720, 720],
  feet_front: [720, 720], feet_side_top: [720, 720],
};

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("We could not process that image.")),
    type === "image/png" ? "image/jpeg" : type,
    quality,
  ));
}

export async function prepareProfileImage(file: File, role: PhotoRole): Promise<PreparedProfileImage> {
  if (!accepted.has(file.type)) throw new Error("Use a JPEG, PNG, or WebP image.");
  if (file.size > maxSourceBytes) throw new Error("Choose an image smaller than 10 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const [minWidth, minHeight] = minimum[role];
    if (bitmap.width < minWidth || bitmap.height < minHeight) {
      throw new Error(`Choose an image at least ${minWidth} by ${minHeight} pixels.`);
    }
    let blob = file.slice(0, file.size, file.type);
    let width = bitmap.width;
    let height = bitmap.height;
    if (Math.max(width, height) > 2048 || file.size > targetBytes) {
      const scale = Math.min(1, 2048 / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      if (width < minWidth || height < minHeight) {
        throw new Error(`Choose an image at least ${minWidth} by ${minHeight} pixels.`);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("We could not process that image.");
      context.drawImage(bitmap, 0, 0, width, height);
      for (const quality of [0.88, 0.75, 0.62]) {
        blob = await canvasBlob(canvas, file.type, quality);
        if (blob.size <= targetBytes) break;
      }
      if (blob.size > targetBytes) throw new Error("Choose an image smaller than 2 MB.");
    }
    return {
      blob,
      metadata: {
        role,
        mime_type: blob.type as PreparedProfileImage["metadata"]["mime_type"],
        width,
        height,
        byte_size: blob.size,
        updated_at: new Date().toISOString(),
      },
    };
  } finally {
    bitmap.close();
  }
}
