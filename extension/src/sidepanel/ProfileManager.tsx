import { useRef, useState } from "react";
import { profilePhotoRoles, type ProfilePhotoRole } from "../profile/requirements";
import { assignLegacyImage, deleteAsset, deleteLegacyImage, deleteProfile } from "../profile/store";
import type { ProfileMetadata } from "../profile/types";
import { ProfileSetup } from "./ProfileSetup";

type Props = { profile: ProfileMetadata | null; legacyImage: string | null; onChanged: () => Promise<void>; onClose: () => void };

const roles = profilePhotoRoles;
const labels: Record<ProfilePhotoRole, string> = {
  face_front: "Front face photo", face_left: "Left face photo", face_right: "Right face photo",
  full_body_front: "Front full-body photo", full_body_side: "Side full-body photo",
};

export function ProfileManager({ profile, legacyImage, onChanged, onClose }: Props) {
  const [legacyRole, setLegacyRole] = useState<ProfilePhotoRole>("face_front");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const mutation = useRef(false);
  const assets = profile?.assets ?? {};

  async function runMutation(action: () => Promise<void>, fallback: string) {
    if (mutation.current) return;
    mutation.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : fallback);
    } finally {
      mutation.current = false;
      setBusy(false);
    }
  }

  async function removeAsset(role: ProfilePhotoRole) {
    if (mutation.current || !globalThis.confirm(`Delete ${labels[role]}?`)) return;
    await runMutation(async () => { await deleteAsset(role); await onChanged(); }, "We could not delete that photo.");
  }

  async function assignLegacy() {
    if (mutation.current) return;
    if (!consent) { setError("Agree to browser-local storage and per-run transmission before assigning this photo."); return; }
    await runMutation(async () => { await assignLegacyImage(legacyRole); await onChanged(); }, "We could not assign that photo.");
  }

  async function removeLegacy() {
    if (mutation.current || !globalThis.confirm("Delete this old photo?")) return;
    await runMutation(async () => { await deleteLegacyImage(); await onChanged(); }, "We could not delete that photo.");
  }

  async function removeProfile() {
    if (mutation.current || !globalThis.confirm("Delete your complete local Yourdrobe profile?")) return;
    let deleted = false;
    await runMutation(async () => {
      await deleteProfile();
      await onChanged();
      deleted = true;
    }, "We could not delete your profile.");
    if (deleted) onClose();
  }

  if (replacing) return <ProfileSetup
    onSaved={() => { void onChanged().then(() => setReplacing(false)); }}
    onCancel={() => setReplacing(false)}
  />;

  return <section className="profile-manager" aria-busy={busy}>
    <div className="profile-heading"><h2>Manage your profile</h2><button type="button" className="secondary" disabled={busy} onClick={onClose}>Close</button></div>
    <p className="profile-completion">{roles.filter((role) => assets[role]).length} of {roles.length} required photos saved.</p>
    <button type="button" disabled={busy} onClick={() => setReplacing(true)}>Replace from one full-body photo</button>
    {(legacyImage || !profile) && <label className="check"><input type="checkbox" disabled={busy} checked={consent} onChange={(event) => setConsent(event.target.checked)} />I agree to browser-local profile storage and per-run transmission of required photos to the Yourdrobe cloud service and its AI processing providers.</label>}
    <div className="list">{roles.map((role) => {
      const asset = assets[role];
      return <article className="profile-asset" key={role}>
        <div><h3>{labels[role]}</h3>{asset ? <p>Updated {new Date(asset.updated_at).toLocaleDateString()}</p> : <p>Generated from your next full-body upload</p>}</div>
        {asset && <button type="button" className="secondary" disabled={busy} onClick={() => void removeAsset(role)}>Delete photo</button>}
      </article>;
    })}</div>
    {legacyImage && <article className="profile-asset legacy-image"><h3>Unclassified existing photo</h3><img src={legacyImage} alt="Unclassified existing photo" /><label>Photo role<select disabled={busy} value={legacyRole} onChange={(event) => setLegacyRole(event.target.value as ProfilePhotoRole)}>{roles.map((role) => <option key={role} value={role}>{labels[role]}</option>)}</select></label><button type="button" disabled={busy} onClick={() => void assignLegacy()}>Assign photo</button><button type="button" className="secondary" disabled={busy} onClick={() => void removeLegacy()}>Delete old photo</button></article>}
    {error && <p className="error" role="alert">{error}</p>}
    <button type="button" className="danger" disabled={busy} onClick={() => void removeProfile()}>Delete complete profile</button>
  </section>;
}
