// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { YouCamConsent } from "./YouCamConsent";

let root: Root;
let host: HTMLDivElement;

function screenButton(name: string) {
  return [...host.querySelectorAll("button")].find((button) => button.textContent === name) as HTMLButtonElement;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("YouCamConsent", () => {
  it("requires cloud-provider acknowledgement before accepting", async () => {
    const onAccept = vi.fn();
    await act(async () => root.render(<YouCamConsent busy={false} error="" onAccept={onAccept} onCancel={vi.fn()} />));
    const accept = screenButton("Agree and create live preview");
    expect(host.textContent).toContain("Perfect Corp");
    expect(host.textContent).toContain("Google Vertex AI");
    expect(host.textContent).toContain("up to 30 days");
    expect(host.textContent).toContain("result links can be temporary");
    expect(host.textContent).toContain("Unless you choose Add this to active outfit");
    expect(host.textContent).toContain("stored browser-locally");
    expect(host.textContent).toContain("uploaded to the selected provider");
    expect(accept.disabled).toBe(true);
    await act(async () => (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click());
    expect(accept.disabled).toBe(false);
    await act(async () => accept.click());
    expect(onAccept).toHaveBeenCalledOnce();
  });

  it("has no camera or API-key control, disables controls while busy, and shows errors", async () => {
    await act(async () => root.render(<YouCamConsent busy error="Try again." onAccept={vi.fn()} onCancel={vi.fn()} />));
    expect(host.textContent?.toLowerCase()).not.toContain("camera");
    expect(host.querySelector('input[type="password"]')).toBeNull();
    expect(host.querySelector('input[type="text"]')).toBeNull();
    expect([...host.querySelectorAll("input, button")].every((control) => (control as HTMLInputElement | HTMLButtonElement).disabled)).toBe(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Try again.");
  });
});
