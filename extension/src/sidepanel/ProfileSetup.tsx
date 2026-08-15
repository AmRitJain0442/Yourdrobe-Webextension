import { useState } from "react";
import type { ProductType } from "../types";
import { prepareProfileImage } from "../profile/image";
import { rolesForRequirement } from "../profile/requirements";
import { saveAsset, saveAttributes } from "../profile/store";
import type { PhotoRole, PreparedProfileImage, ProfileAttributes, RequirementKey } from "../profile/types";

const guidance: Record<RequirementKey, { label: string; help: string }> = {
  face_front: { label: "Front face photo", help: "Use an evenly lit, unobstructed front-facing photo." },
  upper_body_front: { label: "Front upper-body photo", help: "Include your head, shoulders, torso, and waist." },
  full_body_front: { label: "Front full-body photo", help: "Include your full body from head to feet." },
  hand_wrist: { label: "Hand and wrist photo", help: "Show one hand and wrist clearly; choose which side it is." },
  feet_front: { label: "Standing feet photo", help: "Show both feet clearly while standing." },
};

const clothingTypes = new Set(["top", "outerwear", "dress", "bottom", "belt", "bag"]);
const jewelleryTypes = new Set(["watch", "bracelet", "ring"]);

type Props = { requirements: RequirementKey[]; productTypes: ProductType[]; onSaved: () => void; onCancel: () => void };

export function ProfileSetup({ requirements, productTypes, onSaved, onCancel }: Props) {
  const [files, setFiles] = useState<Partial<Record<RequirementKey, File>>>({});
  const [roles, setRoles] = useState<Partial<Record<RequirementKey, PhotoRole>>>({ hand_wrist: "left_hand_wrist" });
  const [errors, setErrors] = useState<Partial<Record<RequirementKey, string>>>({});
  const [attributes, setAttributes] = useState<Partial<Record<keyof ProfileAttributes, string>>>({});
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState("");
  const showClothing = productTypes.some((type) => clothingTypes.has(type));
  const showMakeup = productTypes.includes("makeup");
  const showFootwear = productTypes.includes("footwear");
  const showJewellery = productTypes.some((type) => jewelleryTypes.has(type));

  function setAttribute(key: keyof ProfileAttributes, value: string) {
    setAttributes((current) => ({ ...current, [key]: value }));
  }

  function selectedAttributes(): ProfileAttributes {
    const result: ProfileAttributes = {};
    const text = (key: keyof ProfileAttributes) => { if (attributes[key]?.trim()) (result as Record<string, string>)[key] = attributes[key].trim(); };
    const number = (key: keyof ProfileAttributes) => {
      const value = attributes[key]?.trim();
      if (value && Number.isFinite(Number(value))) (result as Record<string, number>)[key] = Number(value);
    };
    number("height_cm");
    if (showClothing) (["top_size", "bottom_size", "dress_size"] as const).forEach(text), (["chest_cm", "waist_cm", "hips_cm", "inseam_cm"] as const).forEach(number);
    if (showMakeup) (["skin_tone", "undertone"] as const).forEach(text);
    if (showFootwear) (["shoe_size_system", "shoe_size"] as const).forEach(text);
    if (showJewellery) (["ring_size"] as const).forEach(text), (["left_wrist_cm", "right_wrist_cm"] as const).forEach(number);
    return result;
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consent) { setError("Agree to local profile storage before saving."); return; }
    const chosen: { requirement: RequirementKey; role: PhotoRole; file: File }[] = [];
    const missing: Partial<Record<RequirementKey, string>> = {};
    for (const requirement of requirements) {
      const file = files[requirement];
      if (!file) missing[requirement] = "Choose a photo before saving.";
      else chosen.push({ requirement, role: roles[requirement] ?? rolesForRequirement(requirement)[0], file });
    }
    if (Object.keys(missing).length) { setErrors(missing); return; }
    setError("");
    const prepared = await Promise.allSettled(chosen.map(({ file, role }) => prepareProfileImage(file, role)));
    const invalid: Partial<Record<RequirementKey, string>> = {};
    prepared.forEach((result, index) => {
      if (result.status === "rejected") invalid[chosen[index].requirement] = result.reason instanceof Error ? result.reason.message : "We could not process that photo.";
    });
    if (Object.keys(invalid).length) { setErrors(invalid); return; }
    try {
      for (const result of prepared) await saveAsset((result as PromiseFulfilledResult<PreparedProfileImage>).value);
      await saveAttributes(selectedAttributes());
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We could not save your profile photos.");
    }
  }

  return <section>
    <h2>Set up your local profile</h2>
    <p className="profile-progress">{requirements.length} photo{requirements.length === 1 ? "" : "s"} needed for these products.</p>
    <form onSubmit={(event) => void save(event)}>
      <div className="profile-fields">
        {requirements.map((requirement) => <div className="profile-field" key={requirement}>
          <label>{guidance[requirement].label}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFiles((current) => ({ ...current, [requirement]: event.target.files?.[0] }))} /></label>
          {requirement === "hand_wrist" && <label>Hand side<select required value={roles.hand_wrist} onChange={(event) => setRoles((current) => ({ ...current, hand_wrist: event.target.value as PhotoRole }))}><option value="left_hand_wrist">Left hand and wrist</option><option value="right_hand_wrist">Right hand and wrist</option></select></label>}
          <p className="profile-guidance">{guidance[requirement].help}</p>
          {errors[requirement] && <p className="error" role="alert">{errors[requirement]}</p>}
        </div>)}
        <label>Height (cm)<input type="number" min="0" value={attributes.height_cm ?? ""} onChange={(event) => setAttribute("height_cm", event.target.value)} /></label>
        {showClothing && <><label>Top size<input value={attributes.top_size ?? ""} onChange={(event) => setAttribute("top_size", event.target.value)} /></label><label>Bottom size<input value={attributes.bottom_size ?? ""} onChange={(event) => setAttribute("bottom_size", event.target.value)} /></label><label>Dress size<input value={attributes.dress_size ?? ""} onChange={(event) => setAttribute("dress_size", event.target.value)} /></label>{(["chest_cm", "waist_cm", "hips_cm", "inseam_cm"] as const).map((key) => <label key={key}>{key.replace("_cm", " (cm)").replace("_", " ")}<input type="number" min="0" value={attributes[key] ?? ""} onChange={(event) => setAttribute(key, event.target.value)} /></label>)}</>}
        {showMakeup && <><label>Skin tone<select value={attributes.skin_tone ?? ""} onChange={(event) => setAttribute("skin_tone", event.target.value)}><option value="">Choose a skin tone</option><option value="light">Light</option><option value="medium">Medium</option><option value="deep">Deep</option></select></label><label>Undertone<select value={attributes.undertone ?? ""} onChange={(event) => setAttribute("undertone", event.target.value)}><option value="">Choose an undertone</option><option value="warm">Warm</option><option value="neutral">Neutral</option><option value="cool">Cool</option></select></label></>}
        {showFootwear && <><label>Shoe size system<select value={attributes.shoe_size_system ?? ""} onChange={(event) => setAttribute("shoe_size_system", event.target.value)}><option value="">Choose a system</option><option value="UK">UK</option><option value="US">US</option><option value="EU">EU</option></select></label><label>Shoe size<input value={attributes.shoe_size ?? ""} onChange={(event) => setAttribute("shoe_size", event.target.value)} /></label></>}
        {showJewellery && <><label>Ring size<input value={attributes.ring_size ?? ""} onChange={(event) => setAttribute("ring_size", event.target.value)} /></label>{(["left_wrist_cm", "right_wrist_cm"] as const).map((key) => <label key={key}>{key.replace("_cm", " (cm)").replace("_", " ")}<input type="number" min="0" value={attributes[key] ?? ""} onChange={(event) => setAttribute(key, event.target.value)} /></label>)}</>}
      </div>
      <label className="check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />I agree to local profile storage.</label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="profile-actions"><button type="submit">Save profile photos</button><button type="button" className="secondary" onClick={onCancel}>Cancel</button></div>
    </form>
  </section>;
}
