import { useState } from "react";

type Props = {
  busy: boolean;
  error: string;
  onAccept: () => void;
  onCancel: () => void;
};

export function YouCamConsent({ busy, error, onAccept, onCancel }: Props) {
  const [accepted, setAccepted] = useState(false);
  return <section aria-busy={busy}>
    <h2>Enable live YouCam previews</h2>
    <p>The required profile photo and retailer product image will be sent to Perfect Corp for this live preview.</p>
    <p>Perfect Corp may retain uploaded and generated assets for up to 30 days. The generated download URL is temporary. Yourdrobe keeps the preview only in this side-panel session.</p>
    <label className="check"><input type="checkbox" disabled={busy} checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />I agree to Perfect Corp cloud processing for live YouCam previews.</label>
    <button type="button" disabled={busy || !accepted} onClick={onAccept}>Agree and create live preview</button>
    <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
