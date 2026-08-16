import { useEffect, useRef, useState } from "react";
import { prepareProfileImage } from "../profile/image";
import { profilePhotoRoles, type ProfilePhotoRole } from "../profile/requirements";
import { saveAsset } from "../profile/store";
import type { PhotoRole, PreparedProfileImage } from "../profile/types";
import { generateProfileAssets } from "./api";

const labels: Record<ProfilePhotoRole, string> = {
  face_front: "Front face photo",
  face_left: "Left face photo",
  face_right: "Right face photo",
  full_body_front: "Front full-body photo",
  full_body_side: "Side full-body photo",
};

type Generated = { image: PreparedProfileImage; dataUrl: string };
type Props = { existingRoles?: PhotoRole[]; onSaved: () => void; onCancel: () => void };

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("We could not read that photo."));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("We could not read that photo."));
    reader.readAsDataURL(blob);
  });
}

function dataUrlFile(dataUrl: string, role: ProfilePhotoRole): File {
  const match = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("The generated profile contained an invalid image.");
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new File([bytes], `${role}.${match[1] === "image/png" ? "png" : "jpg"}`, { type: match[1] });
}

export function ProfileSetup({ onSaved, onCancel }: Props) {
  const [file, setFile] = useState<File>();
  const [generated, setGenerated] = useState<Generated[]>([]);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const cancelled = useRef(false);
  const request = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => {
    cancelled.current = true;
    request.current?.abort();
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    if (!consent) { setError("Agree to profile photo processing before continuing."); return; }
    if (!file) { setError("Choose one full-body photo before generating your profile."); return; }
    running.current = true;
    setBusy(true);
    setError("");
    try {
      if (generated.length) {
        for (const item of generated) {
          if (cancelled.current) return;
          await saveAsset(item.image);
        }
        if (!cancelled.current) onSaved();
        return;
      }
      const source = await prepareProfileImage(file, "full_body_front");
      request.current = new AbortController();
      const assets = await generateProfileAssets(await blobDataUrl(source.blob), request.current.signal);
      const prepared = await Promise.all(profilePhotoRoles.map(async (role) => {
        const asset = assets.find((candidate) => candidate.kind === role)!;
        return { image: await prepareProfileImage(dataUrlFile(asset.image_data_url, role), role), dataUrl: asset.image_data_url };
      }));
      if (!cancelled.current) setGenerated(prepared);
    } catch (reason) {
      if (!cancelled.current && !(reason instanceof DOMException && reason.name === "AbortError")) {
        setError(reason instanceof Error ? reason.message : "We could not generate your profile photos.");
      }
    } finally {
      request.current = undefined;
      running.current = false;
      if (!cancelled.current) setBusy(false);
    }
  }

  function choose(next?: File) {
    setFile(next);
    setGenerated([]);
    setError("");
  }

  function cancel() {
    cancelled.current = true;
    request.current?.abort();
    onCancel();
  }

  return <section>
    <h2>Create your profile from one photo</h2>
    <p>Upload a clear, well-lit, head-to-toe photo.</p>
    <form aria-busy={busy} onSubmit={(event) => void submit(event)}>
      <fieldset className="profile-fields-group" disabled={busy}>
        <label htmlFor="profile-source">Full-body source photo</label>
        <input id="profile-source" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => choose(event.target.files?.[0])} />
      </fieldset>
      <label className="check"><input type="checkbox" disabled={busy} checked={consent} onChange={(event) => setConsent(event.target.checked)} />I agree to cloud processing and local storage of my profile photos.</label>
      {generated.length > 0 && <div className="generated-profile" aria-label="Generated profile preview">
        <h3>Review your profile</h3>
        <div className="generated-profile-grid">{generated.map(({ image, dataUrl }) => <figure key={image.metadata.role}>
          <img src={dataUrl} alt={labels[image.metadata.role as ProfilePhotoRole]} />
          <figcaption>{labels[image.metadata.role as ProfilePhotoRole]}</figcaption>
        </figure>)}</div>
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="profile-actions">
        <button type="submit" disabled={busy}>{generated.length ? "Save profile" : "Create profile"}</button>
        {generated.length > 0 && <button type="button" className="secondary" disabled={busy} onClick={() => setGenerated([])}>Start over</button>}
        <button type="button" className="secondary" disabled={busy} onClick={cancel}>Cancel</button>
      </div>
    </form>
  </section>;
}
