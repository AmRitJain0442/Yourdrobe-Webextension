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
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Agree to local profile storage before saving.");

    const consent = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => { consent.click(); });
    await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve)); });
    expect(saveAsset).toHaveBeenCalledTimes(2);
    expect(prepareProfileImage).toHaveBeenCalledWith(face.files?.[0], "face_front");
    expect(prepareProfileImage).toHaveBeenCalledWith(hand.files?.[0], "right_hand_wrist");
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
});
