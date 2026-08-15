import { useRef, useState } from "react";
import { prepareProfileImage } from "../profile/image";
import { rolesForRequirement } from "../profile/requirements";
import { assignLegacyImage, deleteAsset, deleteLegacyImage, deleteProfile, saveAsset, saveAttributes } from "../profile/store";
import type { PhotoRole, ProfileAttributes, ProfileMetadata, RequirementKey } from "../profile/types";

type Props = { profile: ProfileMetadata | null; legacyImage: string | null; onChanged: () => Promise<void>; onClose: () => void };

const roles: PhotoRole[] = ["face_front", "face_left", "face_right", "upper_body_front", "upper_body_side", "full_body_front", "full_body_side", "left_hand_wrist", "right_hand_wrist", "feet_front", "feet_side_top"];
const labels: Record<PhotoRole, string> = {
  face_front: "Front face photo", face_left: "Left face photo", face_right: "Right face photo",
  upper_body_front: "Front upper-body photo", upper_body_side: "Side upper-body photo",
  full_body_front: "Front full-body photo", full_body_side: "Side full-body photo",
  left_hand_wrist: "Left hand and wrist photo", right_hand_wrist: "Right hand and wrist photo",
  feet_front: "Front feet photo", feet_side_top: "Side or top feet photo",
};
const categories: [RequirementKey, string][] = [
  ["face_front", "Makeup and face accessories"], ["upper_body_front", "Upper-body clothing"], ["full_body_front", "Full-body clothing"], ["hand_wrist", "Hand and wrist accessories"], ["feet_front", "Footwear"],
];
const attributeGroups: { title: string; fields: { key: keyof ProfileAttributes; label: string; number?: boolean; step?: string }[] }[] = [
  { title: "Body", fields: [{ key: "height_cm", label: "Height (cm)", number: true }, { key: "chest_cm", label: "Chest (cm)", number: true }, { key: "waist_cm", label: "Waist (cm)", number: true }, { key: "hips_cm", label: "Hips (cm)", number: true }, { key: "inseam_cm", label: "Inseam (cm)", number: true }] },
  { title: "Clothing", fields: [{ key: "top_size", label: "Top size" }, { key: "bottom_size", label: "Bottom size" }, { key: "dress_size", label: "Dress size" }] },
  { title: "Beauty", fields: [{ key: "skin_tone", label: "Skin tone" }, { key: "undertone", label: "Undertone" }] },
  { title: "Accessories", fields: [{ key: "shoe_size_system", label: "Shoe size system" }, { key: "shoe_size", label: "Shoe size" }, { key: "ring_size", label: "Ring size" }, { key: "left_wrist_cm", label: "Left wrist (cm)", number: true, step: "0.1" }, { key: "right_wrist_cm", label: "Right wrist (cm)", number: true, step: "0.1" }] },
];
const numberKeys = new Set<keyof ProfileAttributes>(["height_cm", "chest_cm", "waist_cm", "hips_cm", "inseam_cm", "left_wrist_cm", "right_wrist_cm"]);

export function ProfileManager({ profile, legacyImage, onChanged, onClose }: Props) {
  const [attributes, setAttributes] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(profile?.attributes ?? {}).map(([key, value]) => [key, String(value)])));
  const [legacyRole, setLegacyRole] = useState<PhotoRole>("face_front");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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

  async function replace(role: PhotoRole, file?: File) {
    if (!file) return;
    await runMutation(async () => {
      await saveAsset(await prepareProfileImage(file, role));
      await onChanged();
    }, "We could not save that photo.");
  }

  async function removeAsset(role: PhotoRole) {
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

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.current) return;
    if (!profile && !consent) { setError("Agree to browser-local storage and per-run transmission before saving attributes."); return; }
    const next: ProfileAttributes = {};
    for (const group of attributeGroups) for (const field of group.fields) {
      const value = attributes[field.key]?.trim();
      (next as Record<string, string | number | undefined>)[field.key] = value ? numberKeys.has(field.key) ? Number(value) : value : undefined;
    }
    await runMutation(async () => { await saveAttributes(next); await onChanged(); }, "We could not save your attributes.");
  }

  async function removeProfile() {
    if (mutation.current || !globalThis.confirm("Delete your complete local Yourdrobe profile?")) return;
    let deleted = false;
    await runMutation(async () => {
      await deleteProfile();
      setAttributes({});
      await onChanged();
      deleted = true;
    }, "We could not delete your profile.");
    if (deleted) onClose();
  }

  return <section className="profile-manager" aria-busy={busy}>
    <div className="profile-heading"><h2>Manage your profile</h2><button type="button" className="secondary" disabled={busy} onClick={onClose}>Close</button></div>
    <div className="profile-completion">{categories.map(([requirement, label]) => <p key={requirement}>{label}<strong>{rolesForRequirement(requirement).some((role) => assets[role]) ? "Complete" : "Photo needed"}</strong></p>)}</div>
    <div className="list">{roles.filter((role) => assets[role]).map((role) => <article className="profile-asset" key={role}>
      <div><h3>{labels[role]}</h3><p>Updated {new Date(assets[role]!.updated_at).toLocaleDateString()}</p></div>
      <label>Replace photo<input type="file" disabled={busy} accept="image/jpeg,image/png,image/webp" onChange={(event) => void replace(role, event.target.files?.[0])} /></label>
      <button type="button" className="secondary" disabled={busy} onClick={() => void removeAsset(role)}>Delete photo</button>
    </article>)}</div>
    {(legacyImage || !profile) && <label className="check"><input type="checkbox" disabled={busy} checked={consent} onChange={(event) => setConsent(event.target.checked)} />I agree to browser-local profile storage and per-run transmission of required photos and optional attributes to 127.0.0.1:8001.</label>}
    {legacyImage && <article className="profile-asset legacy-image"><h3>Unclassified existing photo</h3><img src={legacyImage} alt="Unclassified existing photo" /><label>Photo role<select disabled={busy} value={legacyRole} onChange={(event) => setLegacyRole(event.target.value as PhotoRole)}>{roles.map((role) => <option key={role} value={role}>{labels[role]}</option>)}</select></label><button type="button" disabled={busy} onClick={() => void assignLegacy()}>Assign photo</button><button type="button" className="secondary" disabled={busy} onClick={() => void removeLegacy()}>Delete old photo</button></article>}
    <form onSubmit={(event) => void save(event)}><h3>Optional attributes</h3>{attributeGroups.map((group) => <fieldset disabled={busy} key={group.title}><legend>{group.title}</legend>{group.fields.map((field) => <label key={field.key}>{field.label}<input name={field.key} type={field.number ? "number" : "text"} min={field.number ? "0.1" : undefined} step={field.number ? field.step ?? "0.1" : undefined} value={attributes[field.key] ?? ""} onChange={(event) => setAttributes((current) => ({ ...current, [field.key]: event.target.value }))} /></label>)}</fieldset>)}<button type="submit" disabled={busy}>Save attributes</button></form>
    {error && <p className="error" role="alert">{error}</p>}
    <button type="button" className="danger" disabled={busy} onClick={() => void removeProfile()}>Delete complete profile</button>
  </section>;
}
