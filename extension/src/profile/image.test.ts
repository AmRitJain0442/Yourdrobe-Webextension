// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareProfileImage } from "./image";

beforeEach(() => {
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 800, height: 800, close: vi.fn() }));
});

describe("prepareProfileImage", () => {
  it("rejects unsupported image types", async () => {
    await expect(prepareProfileImage(new File(["x"], "photo.gif", { type: "image/gif" }), "face_front"))
      .rejects.toThrow("Use a JPEG, PNG, or WebP image.");
  });

  it("rejects a face image below its minimum dimensions", async () => {
    vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: 600, height: 700, close: vi.fn() } as never);
    await expect(prepareProfileImage(new File(["x"], "face.jpg", { type: "image/jpeg" }), "face_front"))
      .rejects.toThrow("at least 720 by 720 pixels");
  });

  it("returns metadata for a valid image without retaining its file name", async () => {
    const result = await prepareProfileImage(new File(["x"], "private-name.jpg", { type: "image/jpeg" }), "face_front");
    expect(result.metadata).toMatchObject({ role: "face_front", width: 800, height: 800, mime_type: "image/jpeg" });
    expect(JSON.stringify(result.metadata)).not.toContain("private-name");
  });

  it("normalizes oversized images through canvas", async () => {
    vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: 4096, height: 2048, close: vi.fn() } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["small"], { type: "image/jpeg" })));

    const source = new File(["x".repeat(2 * 1024 * 1024 + 1)], "large.jpg", { type: "image/jpeg" });
    const result = await prepareProfileImage(source, "face_front");

    expect(Math.max(result.metadata.width, result.metadata.height)).toBeLessThanOrEqual(2048);
    expect(result.blob).not.toBe(source);
  });
});
