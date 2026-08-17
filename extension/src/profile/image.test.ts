// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareProfileImage } from "./image";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 800, height: 800, close: vi.fn() }));
});

describe("prepareProfileImage", () => {
  it("rejects unsupported image types", async () => {
    await expect(prepareProfileImage(new File(["x"], "photo.gif", { type: "image/gif" }), "face_front"))
      .rejects.toThrow("Use a JPEG, PNG, or WebP image.");
  });

  it("accepts a small source image without imposing provider-independent dimensions", async () => {
    vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: 600, height: 700, close: vi.fn() } as never);
    const result = await prepareProfileImage(new File(["x"], "face.jpg", { type: "image/jpeg" }), "face_front");
    expect(result.metadata).toMatchObject({ width: 600, height: 700 });
  });

  it("returns metadata for a valid image without retaining its file name", async () => {
    const result = await prepareProfileImage(new File(["x"], "private-name.jpg", { type: "image/jpeg" }), "face_front");
    expect(result.metadata).toMatchObject({ role: "face_front", width: 800, height: 800, mime_type: "image/jpeg" });
    expect(JSON.stringify(result.metadata)).not.toContain("private-name");
    expect("name" in result.blob).toBe(false);
  });

  it("normalizes an extreme aspect ratio without imposing minimum dimensions", async () => {
    vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: 720, height: 10_000, close: vi.fn() } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["small"], { type: "image/jpeg" })));

    const result = await prepareProfileImage(new File(["x"], "tall.jpg", { type: "image/jpeg" }), "face_front");
    expect(result.metadata).toMatchObject({ width: 147, height: 2048 });
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

  it("rejects an image that cannot be compressed below 2 MiB", async () => {
    vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: 2048, height: 2048, close: vi.fn() } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn() } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["x".repeat(2 * 1024 * 1024 + 1)], { type: "image/jpeg" })));

    await expect(prepareProfileImage(new File(["x".repeat(2 * 1024 * 1024 + 1)], "noisy.jpg", { type: "image/jpeg" }), "face_front"))
      .rejects.toThrow("Choose an image smaller than 2 MB.");
  });

  it("closes the decoded bitmap when canvas processing fails", async () => {
    const close = vi.fn();
    vi.mocked(createImageBitmap).mockResolvedValueOnce({ width: 4096, height: 2048, close } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: () => { throw new Error("canvas failed"); } } as never);

    await expect(prepareProfileImage(new File(["x"], "large.jpg", { type: "image/jpeg" }), "face_front"))
      .rejects.toThrow("canvas failed");
    expect(close).toHaveBeenCalledOnce();
  });
});
