// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareProfileImage } from "../profile/image";
import { saveAsset, saveAttributes } from "../profile/store";
import { ProfileSetup } from "./ProfileSetup";

vi.mock("../profile/image", () => ({ prepareProfileImage: vi.fn() }));
vi.mock("../profile/store", () => ({ saveAsset: vi.fn(), saveAttributes: vi.fn() }));

let root: Root;
let host: HTMLDivElement;
const onSaved = vi.fn();

function choose(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.mocked(prepareProfileImage).mockImplementation(async (_file, role) => ({
    blob: new Blob([role], { type: "image/jpeg" }),
    metadata: { role, mime_type: "image/jpeg", width: 720, height: 720, byte_size: 1, updated_at: "2026-08-15T00:00:00.000Z" },
  }));
  vi.mocked(saveAsset).mockResolvedValue({} as never);
  vi.mocked(saveAttributes).mockResolvedValue({} as never);
  onSaved.mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("ProfileSetup", () => {
  it("requires consent before saving selected progressive profile photos", async () => {
    await act(async () => {
      root.render(<ProfileSetup requirements={["face_front", "hand_wrist"]} productTypes={["makeup", "watch"]} onSaved={onSaved} onCancel={vi.fn()} />);
    });
    expect(host.textContent).toContain("Front face photo");
    expect(host.textContent).toContain("Hand and wrist photo");
    expect(host.querySelectorAll('input[type="file"]')).toHaveLength(2);

    const select = host.querySelector("select") as HTMLSelectElement;
    select.value = "right_hand_wrist";
    await act(async () => { select.dispatchEvent(new Event("change", { bubbles: true })); });
    const [face, hand] = Array.from(host.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    await act(async () => {
      choose(face, new File(["face"], "face.jpg", { type: "image/jpeg" }));
      choose(hand, new File(["hand"], "hand.jpg", { type: "image/jpeg" }));
    });
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === "Save profile photos") as HTMLButtonElement;
    await act(async () => { button.click(); });
    expect(saveAsset).not.toHaveBeenCalled();
    expect(saveAttributes).not.toHaveBeenCalled();
    expect(host.textContent).toContain("browser-local profile storage and per-run transmission");
    expect(host.textContent).toContain("127.0.0.1:8001");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Agree to browser-local storage and per-run transmission before saving.");

    const consent = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { consent.click(); });
    await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve)); });
    expect(saveAsset).toHaveBeenCalledTimes(2);
    expect(prepareProfileImage).toHaveBeenCalledWith(face.files?.[0], "face_front");
    expect(prepareProfileImage).toHaveBeenCalledWith(hand.files?.[0], "right_hand_wrist");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("waits for each asset save before starting the next metadata write", async () => {
    let releaseFirstSave = () => {};
    vi.mocked(saveAsset).mockImplementationOnce(() => new Promise((resolve) => { releaseFirstSave = () => resolve({} as never); })).mockResolvedValue({} as never);
    await act(async () => {
      root.render(<ProfileSetup requirements={["face_front", "hand_wrist"]} productTypes={[]} onSaved={onSaved} onCancel={vi.fn()} />);
    });
    const [face, hand] = Array.from(host.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    await act(async () => {
      choose(face, new File(["face"], "face.jpg", { type: "image/jpeg" }));
      choose(hand, new File(["hand"], "hand.jpg", { type: "image/jpeg" }));
      (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    });
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === "Save profile photos") as HTMLButtonElement;
    await act(async () => { button.click(); await Promise.resolve(); });
    expect(saveAsset).toHaveBeenCalledTimes(1);
    await act(async () => { releaseFirstSave(); await Promise.resolve(); });
    expect(saveAsset).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("does not write any assets when one selected photo is invalid", async () => {
    vi.mocked(prepareProfileImage).mockImplementation(async (_file, role) => {
      if (role === "right_hand_wrist") throw new Error("Choose a clearer hand photo.");
      return { blob: new Blob(), metadata: { role, mime_type: "image/jpeg", width: 720, height: 720, byte_size: 0, updated_at: "2026-08-15T00:00:00.000Z" } };
    });
    await act(async () => {
      root.render(<ProfileSetup requirements={["face_front", "hand_wrist"]} productTypes={[]} onSaved={onSaved} onCancel={vi.fn()} />);
    });
    const select = host.querySelector("select") as HTMLSelectElement;
    select.value = "right_hand_wrist";
    await act(async () => { select.dispatchEvent(new Event("change", { bubbles: true })); });
    const [face, hand] = Array.from(host.querySelectorAll('input[type="file"]')) as HTMLInputElement[];
    await act(async () => {
      choose(face, new File(["face"], "face.jpg", { type: "image/jpeg" }));
      choose(hand, new File(["hand"], "hand.jpg", { type: "image/jpeg" }));
      (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    });
    const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === "Save profile photos") as HTMLButtonElement;
    await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve)); });
    expect(host.textContent).toContain("Choose a clearer hand photo.");
    expect(saveAsset).not.toHaveBeenCalled();
    expect(saveAttributes).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("places upload guidance before the input and associates guidance and errors", async () => {
    await act(async () => {
      root.render(<ProfileSetup requirements={["face_front"]} productTypes={[]} onSaved={onSaved} onCancel={vi.fn()} />);
    });
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    const guidance = host.querySelector(".profile-guidance") as HTMLParagraphElement;
    expect(host.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    expect(guidance.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(input.getAttribute("aria-describedby")).toBe(guidance.id);

    await act(async () => {
      (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
      (host.querySelector('button[type="submit"]') as HTMLButtonElement).click();
    });

    const roleError = host.querySelector('.profile-field [role="alert"]') as HTMLParagraphElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(roleError.id);
  });

  it("cancels during preparation before writing any profile data", async () => {
    let releasePreparation!: (value: Awaited<ReturnType<typeof prepareProfileImage>>) => void;
    vi.mocked(prepareProfileImage).mockImplementationOnce(() => new Promise((resolve) => { releasePreparation = resolve; }));
    const onCancel = vi.fn();
    await act(async () => {
      root.render(<ProfileSetup requirements={["face_front"]} productTypes={[]} onSaved={onSaved} onCancel={onCancel} />);
    });
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      choose(input, new File(["face"], "face.jpg", { type: "image/jpeg" }));
      (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
      (host.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    await act(async () => {
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Cancel")?.click();
    });
    await act(async () => {
      releasePreparation({ blob: new Blob(["face"], { type: "image/jpeg" }), metadata: { role: "face_front", mime_type: "image/jpeg", width: 720, height: 720, byte_size: 4, updated_at: "2026-08-15T00:00:00.000Z" } });
      await Promise.resolve();
    });

    expect(onCancel).toHaveBeenCalledOnce();
    expect(saveAsset).not.toHaveBeenCalled();
    expect(saveAttributes).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("runs only one save while disabling controls", async () => {
    let releasePreparation!: (value: Awaited<ReturnType<typeof prepareProfileImage>>) => void;
    vi.mocked(prepareProfileImage).mockImplementationOnce(() => new Promise((resolve) => { releasePreparation = resolve; }));
    await act(async () => {
      root.render(<ProfileSetup requirements={["face_front"]} productTypes={[]} onSaved={onSaved} onCancel={vi.fn()} />);
    });
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    const consent = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const saveButton = host.querySelector('button[type="submit"]') as HTMLButtonElement;
    await act(async () => {
      choose(input, new File(["face"], "face.jpg", { type: "image/jpeg" }));
      consent.click();
      saveButton.click();
      saveButton.click();
      await Promise.resolve();
    });
    const controlsWereDisabled = input.matches(":disabled") && consent.matches(":disabled") && saveButton.matches(":disabled");
    await act(async () => {
      releasePreparation({ blob: new Blob(["face"], { type: "image/jpeg" }), metadata: { role: "face_front", mime_type: "image/jpeg", width: 720, height: 720, byte_size: 4, updated_at: "2026-08-15T00:00:00.000Z" } });
      await new Promise((resolve) => setTimeout(resolve));
    });

    expect(controlsWereDisabled).toBe(true);
    expect(prepareProfileImage).toHaveBeenCalledOnce();
    expect(saveAsset).toHaveBeenCalledOnce();
    expect(saveAttributes).toHaveBeenCalledOnce();
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
