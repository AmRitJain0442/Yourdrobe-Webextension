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
    <h2>Enable live cloud previews</h2>
    <p>The required profile photo, current outfit when present, and retailer product image will be sent to Perfect Corp for clothing or shoes, or Google Vertex AI for other products.</p>
    <p>Perfect Corp may retain uploaded and generated assets for up to 30 days. Provider result links can be temporary. Unless you choose Add this to active outfit, Yourdrobe keeps the preview only in this side-panel session. An active outfit is stored browser-locally and uploaded to the selected provider when you request another preview.</p>
    <label className="check"><input type="checkbox" disabled={busy} checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />I agree to Perfect Corp or Google Vertex AI cloud processing for live previews.</label>
    <button type="button" disabled={busy || !accepted} onClick={onAccept}>Agree and create live preview</button>
    <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
