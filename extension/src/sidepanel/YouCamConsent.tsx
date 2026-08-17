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
    <h2>Enable previews</h2>
    <label className="check"><input type="checkbox" disabled={busy} checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />I agree to cloud processing of my profile, outfit, and product images, which may be retained for up to 30 days.</label>
    <button type="button" disabled={busy || !accepted} onClick={onAccept}>Continue</button>
    <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
