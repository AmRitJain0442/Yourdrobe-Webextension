import { useEffect, useRef, useState } from "react";
import { prepareProfileImage } from "../profile/image";
import { profilePhotoRoles, type ProfilePhotoRole } from "../profile/requirements";
import { saveAsset } from "../profile/store";
import type { PhotoRole, PreparedProfileImage } from "../profile/types";

const guidance: Record<ProfilePhotoRole, { label: string; help: string }> = {
  face_front: { label: "Front face photo", help: "Use an evenly lit, unobstructed front-facing photo." },
  face_left: { label: "Left face photo", help: "Turn your face to the left in even lighting." },
  face_right: { label: "Right face photo", help: "Turn your face to the right in even lighting." },
  full_body_front: { label: "Front full-body photo", help: "Include your full body from head to feet." },
  full_body_side: { label: "Side full-body photo", help: "Include your full body from head to feet from the side." },
};

type Props = { existingRoles?: PhotoRole[]; onSaved: () => void; onCancel: () => void };

export function ProfileSetup({ existingRoles = [], onSaved, onCancel }: Props) {
  const requiredRoles = profilePhotoRoles.filter((role) => !existingRoles.includes(role));
  const [files, setFiles] = useState<Partial<Record<ProfilePhotoRole, File>>>({});
  const [errors, setErrors] = useState<Partial<Record<ProfilePhotoRole, string>>>({});
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);

  function setFile(role: ProfilePhotoRole, file?: File) {
    setFiles((current) => ({ ...current, [role]: file }));
    setErrors((current) => {
      if (!current[role]) return current;
      const next = { ...current };
      delete next[role];
      return next;
    });
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    cancelled.current = false;
    setBusy(true);
    let saved = false;
    try {
      if (!consent) { setError("Agree to browser-local storage and per-run transmission before saving."); return; }
      const chosen: { role: ProfilePhotoRole; file: File }[] = [];
      const missing: Partial<Record<ProfilePhotoRole, string>> = {};
      for (const role of requiredRoles) {
        const file = files[role];
        if (!file) missing[role] = "Choose a photo before saving.";
        else chosen.push({ role, file });
      }
      if (Object.keys(missing).length) { setErrors(missing); return; }
      setError("");
      const prepared = await Promise.allSettled(chosen.map(({ file, role }) => prepareProfileImage(file, role)));
      const invalid: Partial<Record<ProfilePhotoRole, string>> = {};
      prepared.forEach((result, index) => {
        if (result.status === "rejected") invalid[chosen[index].role] = result.reason instanceof Error ? result.reason.message : "We could not process that photo.";
      });
      if (Object.keys(invalid).length) { setErrors(invalid); return; }
      if (cancelled.current) return;
      try {
        for (const result of prepared) {
          if (cancelled.current) return;
          await saveAsset((result as PromiseFulfilledResult<PreparedProfileImage>).value);
        }
        if (cancelled.current) return;
        saved = !cancelled.current;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "We could not save your profile photos.");
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
    if (saved) onSaved();
  }

  function cancel() {
    if (cancelled.current) return;
    cancelled.current = true;
    onCancel();
  }

  return <section>
    <h2>Set up your local profile</h2>
    <p className="profile-progress">{requiredRoles.length} of {profilePhotoRoles.length} required photos still needed.</p>
    <form aria-busy={busy} onSubmit={(event) => void save(event)}>
      <fieldset className="profile-fields-group" disabled={busy}>
        <div className="profile-fields">
          {requiredRoles.map((role) => {
            const inputId = `${role}-photo`;
            const guidanceId = `${role}-guidance`;
            const errorId = `${role}-error`;
            return <div className="profile-field" key={role}>
              <label htmlFor={inputId}>{guidance[role].label}</label>
              <p className="profile-guidance" id={guidanceId}>{guidance[role].help}</p>
              <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" aria-describedby={`${guidanceId}${errors[role] ? ` ${errorId}` : ""}`} aria-invalid={errors[role] ? true : undefined} onChange={(event) => setFile(role, event.target.files?.[0])} />
              {errors[role] && <p className="error" id={errorId} role="alert">{errors[role]}</p>}
            </div>;
          })}
        </div>
      </fieldset>
      <label className="check"><input type="checkbox" disabled={busy} checked={consent} onChange={(event) => setConsent(event.target.checked)} />I agree to browser-local profile storage and per-run transmission of required photos to 127.0.0.1:8001.</label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="profile-actions"><button type="submit" disabled={busy}>Save profile photos</button><button type="button" className="secondary" onClick={cancel}>Cancel</button></div>
    </form>
  </section>;
}
