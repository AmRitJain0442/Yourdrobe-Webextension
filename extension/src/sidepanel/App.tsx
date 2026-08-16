import { useEffect, useRef, useState } from "react";
import type { ExtractProductsResponse, Product, ProductType, TryOnJob } from "../types";
import { missingRequirements, requirementsForProducts, rolesForRequirement } from "../profile/requirements";
import { deleteActiveOutfit, LocalProfileAssetMissingError, loadActiveOutfit, loadLegacyImage, loadProfile, loadRequiredAssets, saveActiveOutfit, saveYouCamConsent } from "../profile/store";
import type { ActiveOutfit, PhotoRole, ProfileMetadata, RequirementKey } from "../profile/types";
import { getCapabilities, getJob, getResultImage, MissingProfileAssetsError, startDemo, type NormalizedProduct } from "./api";
import { ProfileSetup } from "./ProfileSetup";
import { ProfileManager } from "./ProfileManager";
import { YouCamConsent } from "./YouCamConsent";

type Phase = "loading" | "profile-setup" | "profile-manager" | "youcam-consent" | "ready" | "running" | "results" | "empty" | "error";
type Result = { product: NormalizedProduct; job: TryOnJob };
const unsupported = "Open a supported Amazon, Flipkart, or Nykaa listing page and try again.";
const maxPolls = 40;
const pollDelayMs = 2_000;
const pollDeadlineMs = 80_000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isHttpsUrl = (value?: string) => {
  if (!value) return false;
  try { return new URL(value).protocol === "https:"; }
  catch { return false; }
};
const selectableProductTypes: ProductType[] = [
  "makeup", "eyewear", "headwear", "earrings", "necklace", "top", "outerwear",
  "dress", "bottom", "belt", "bag", "watch", "bracelet", "ring", "footwear",
];

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [products, setProducts] = useState<Product[]>([]);
  const [profile, setProfile] = useState<ProfileMetadata | null>(null);
  const [legacyImage, setLegacyImage] = useState<string | null>(null);
  const [activeOutfit, setActiveOutfit] = useState<ActiveOutfit | null>(null);
  const [missing, setMissing] = useState<RequirementKey[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [outfitBusy, setOutfitBusy] = useState(false);
  const [outfitStatus, setOutfitStatus] = useState("");
  const [outfitError, setOutfitError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);
  const outfitMutation = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void Promise.all([
      chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (!tab?.id) throw new Error(unsupported);
        try {
          const response = await chrome.tabs.sendMessage<unknown, ExtractProductsResponse>(tab.id, { type: "EXTRACT_PRODUCTS" });
          if (!response.ok) throw new Error(response.error);
          return response.products;
        } catch {
          throw new Error(unsupported);
        }
      }),
      loadProfile(),
      loadLegacyImage(),
      loadActiveOutfit(),
    ]).then(([foundProducts, foundProfile, foundLegacyImage, foundActiveOutfit]) => {
      if (cancelled) return;
      setProducts(foundProducts);
      setProfile(foundProfile);
      setLegacyImage(foundLegacyImage);
      setActiveOutfit(foundActiveOutfit);
      setPhase(foundProducts.length ? "ready" : "empty");
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setError(reason instanceof Error ? reason.message : unsupported);
      setPhase("error");
    });
    return () => {
      cancelled = true;
      mounted.current = false;
      activeRequest.current?.abort();
    };
  }, []);

  async function reloadProfile() {
    const [nextProfile, nextLegacyImage, nextActiveOutfit] = await Promise.all([loadProfile(), loadLegacyImage(), loadActiveOutfit()]);
    setProfile(nextProfile);
    setLegacyImage(nextLegacyImage);
    setActiveOutfit(nextActiveOutfit);
  }

  async function runDemo(currentProfile = profile) {
    const selectedProducts = products.slice(0, 5);
    const availableRoles = Object.keys(currentProfile?.assets ?? {}) as PhotoRole[];
    if (activeOutfit) availableRoles.push("full_body_front");
    const required = missingRequirements(selectedProducts, availableRoles);
    if (required.length) {
      setMissing(required);
      setPhase("profile-setup");
      return;
    }
    activeRequest.current?.abort();
    const request = new AbortController();
    activeRequest.current = request;
    setPhase("running");
    setError("");
    let pollDeadline: AbortController | undefined;
    let pollDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const capabilities = await getCapabilities(request.signal);
      if (request.signal.aborted) return;
      const usesYouCam = capabilities.tryon_provider === "youcam"
        && selectedProducts.some((product) => product.product_type && capabilities.live_product_types.includes(product.product_type));
      if (usesYouCam && !currentProfile?.youcam_consented_at) {
        setConsentError("");
        setPhase("youcam-consent");
        return;
      }
      const available = new Set(Object.keys(currentProfile?.assets ?? {}) as PhotoRole[]);
      const roles = requirementsForProducts(selectedProducts)
        .filter((requirement) => requirement !== "full_body_front" || !activeOutfit)
        .map((requirement) =>
        rolesForRequirement(requirement).find((role) => available.has(role)) ?? rolesForRequirement(requirement)[0],
      );
      const assets = await loadRequiredAssets(roles);
      const started = await startDemo(assets, currentProfile?.attributes ?? {}, selectedProducts, Boolean(currentProfile?.youcam_consented_at), activeOutfit?.image_data_url, request.signal);
      if (request.signal.aborted) return;
      pollDeadline = new AbortController();
      pollDeadlineTimer = setTimeout(
        () => pollDeadline?.abort(new DOMException("Polling timed out", "TimeoutError")),
        pollDeadlineMs,
      );
      const pollSignal = AbortSignal.any([request.signal, pollDeadline.signal]);
      let current = started.jobs;
      for (let polls = 0; current.some((job) => job.status === "queued" || job.status === "processing") && polls < maxPolls; polls += 1) {
        await delay(pollDelayMs);
        if (request.signal.aborted) return;
        current = await Promise.all(current.map((job) =>
          job.status === "completed" || job.status === "failed" ? job : getJob(job.job_id, pollSignal),
        ));
        if (pollDeadline.signal.aborted) throw new Error("The preview is taking too long. Please try again.");
        if (request.signal.aborted) return;
      }
      if (current.some((job) => job.status === "queued" || job.status === "processing")) throw new Error("The preview is taking too long. Please try again.");
      const byId = new Map(started.products.map((product) => [product.id, product]));
      setResults(current.flatMap((job) => {
        const product = byId.get(job.product_id);
        return product ? [{ product, job }] : [];
      }));
      setPhase("results");
    } catch (reason) {
      if (request.signal.aborted) return;
      if (pollDeadline?.signal.aborted) {
        setError("The preview is taking too long. Please try again.");
        setPhase("error");
        return;
      }
      if (reason instanceof MissingProfileAssetsError) {
        setMissing(reason.roles);
        setPhase("profile-setup");
        return;
      }
      if (reason instanceof LocalProfileAssetMissingError) {
        const repaired = await loadProfile();
        setProfile(repaired);
        const repairedRoles = Object.keys(repaired?.assets ?? {}) as PhotoRole[];
        if (activeOutfit) repairedRoles.push("full_body_front");
        setMissing(missingRequirements(selectedProducts, repairedRoles));
        setPhase("profile-setup");
        return;
      }
      setError(reason instanceof Error ? reason.message : "The local backend is unavailable.");
      setPhase("error");
    } finally {
      if (pollDeadlineTimer) clearTimeout(pollDeadlineTimer);
      if (activeRequest.current === request) activeRequest.current = null;
    }
  }

  async function acceptYouCamConsent() {
    setConsentBusy(true);
    setConsentError("");
    try {
      const consented = await saveYouCamConsent();
      if (!mounted.current) return;
      setProfile(consented);
      await runDemo(consented);
    } catch (reason) {
      if (!mounted.current) return;
      setConsentError(reason instanceof Error ? reason.message : "Could not save your consent. Please try again.");
      setPhase("youcam-consent");
    } finally {
      if (mounted.current) setConsentBusy(false);
    }
  }

  async function useAsActiveOutfit(result: Result) {
    if (outfitMutation.current) return;
    outfitMutation.current = true;
    setOutfitBusy(true);
    setOutfitStatus("Saving active outfit...");
    setOutfitError("");
    try {
      const blob = await getResultImage(result.job.job_id);
      const saved = await saveActiveOutfit(blob, {
        job_id: result.job.job_id,
        product_id: result.product.id,
        product_title: result.product.title,
        product_type: result.product.product_type ?? "unknown",
        product_url: result.product.product_url,
      });
      if (!mounted.current) return;
      setActiveOutfit(saved);
      setOutfitStatus("Active outfit saved.");
    } catch (reason) {
      if (!mounted.current) return;
      setOutfitStatus("");
      setOutfitError(reason instanceof Error ? reason.message : "We could not save that outfit. Please try again.");
    } finally {
      outfitMutation.current = false;
      if (mounted.current) setOutfitBusy(false);
    }
  }

  async function resetActiveOutfit() {
    if (outfitMutation.current) return;
    outfitMutation.current = true;
    setOutfitBusy(true);
    setOutfitStatus("Resetting active outfit...");
    setOutfitError("");
    try {
      await deleteActiveOutfit();
      if (!mounted.current) return;
      setActiveOutfit(null);
      setOutfitStatus("Active outfit reset.");
    } catch (reason) {
      if (!mounted.current) return;
      setOutfitStatus("");
      setOutfitError(reason instanceof Error ? reason.message : "We could not reset that outfit. Please try again.");
    } finally {
      outfitMutation.current = false;
      if (mounted.current) setOutfitBusy(false);
    }
  }

  function openProfileManager() {
    if (!outfitMutation.current) setPhase("profile-manager");
  }

  return <main>
    <header><span className="eyebrow">Yourdrobe</span><h1>Your fitting room, anywhere.</h1></header>
    {phase === "loading" && <p role="status">Reading products from this page...</p>}
    {(phase === "ready" || phase === "results") && activeOutfit && <ActiveOutfitPanel outfit={activeOutfit} busy={outfitBusy} onReset={() => void resetActiveOutfit()} />}
    {(phase === "ready" || phase === "results") && outfitStatus && <p className="outfit-message" role="status">{outfitStatus}</p>}
    {(phase === "ready" || phase === "results") && outfitError && <p className="error outfit-message" role="alert">{outfitError}</p>}
    {phase === "profile-setup" && <ProfileSetup requirements={missing} productTypes={products.map((product) => product.product_type ?? "unknown")} onSaved={() => void reloadProfile().then(() => setPhase("ready"))} onCancel={() => setPhase("ready")} />}
    {phase === "profile-manager" && <ProfileManager profile={profile} legacyImage={legacyImage} onChanged={reloadProfile} onClose={() => setPhase(products.length ? "ready" : "empty")} />}
    {phase === "youcam-consent" && <div className="youcam-consent"><YouCamConsent busy={consentBusy} error={consentError} onAccept={() => void acceptYouCamConsent()} onCancel={() => setPhase("ready")} /></div>}
    {phase === "ready" && <section>
      <h2>{products.length} products ready</h2>
      <div className="list">{products.map((product, index) => <div key={product.product_url}><ProductRow product={product} />
        {(!product.product_type || product.product_type === "unknown") && <label>Choose product type for {product.title}<select required value={product.product_type ?? "unknown"} onChange={(event) => setProducts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, product_type: event.target.value as ProductType } : item))}><option value="unknown">Choose product type</option>{selectableProductTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>}
      </div>)}</div>
      <button disabled={products.some((product) => !product.product_type || product.product_type === "unknown")} onClick={() => void runDemo()}>Try these products</button>
      <button className="secondary" disabled={outfitBusy} onClick={openProfileManager}>Manage profile</button>
    </section>}
    {phase === "running" && <p role="status">Creating your previews...</p>}
    {phase === "empty" && <section><h2>No products found on this page.</h2><p>Browse a product listing or search results on this supported site, then retry.</p><button onClick={() => location.reload()}>Retry</button></section>}
    {phase === "results" && <section>
      <h2>Your previews</h2>
      <div className="list">{results.map(({ product, job }) => {
        const failed = job.status === "failed" || (job.mock === false && !isHttpsUrl(job.result_url));
        return <article className="product" key={job.job_id}>
          <div><span className="badge">{job.mock === false ? "YouCam AI preview" : "Mock AI preview"}</span><h3>{product.title}</h3></div>
          {failed
            ? <p className="error">{job.error_message ?? "This product preview failed. You can still view the original listing."}</p>
            : <img src={job.result_url || product.image_url} alt={`Preview of ${product.title}`} />}
          {job.status === "completed" && job.mock === false && isHttpsUrl(job.result_url) && <button disabled={outfitBusy} onClick={() => void useAsActiveOutfit({ product, job })}>Use as active outfit</button>}
          <a className="button secondary" href={product.product_url} target="_blank" rel="noreferrer">View original product</a>
        </article>;
      })}</div>
      <button className="secondary" disabled={outfitBusy} onClick={openProfileManager}>Manage profile</button>
    </section>}
    {phase === "error" && <section><p className="error" role="alert">{error}</p><button onClick={() => location.reload()}>Retry</button></section>}
  </main>;
}

function ActiveOutfitPanel({ outfit, busy, onReset }: { outfit: ActiveOutfit; busy: boolean; onReset: () => void }) {
  return <article className="product active-outfit" aria-labelledby="active-outfit-heading">
    <h2 id="active-outfit-heading">Active outfit</h2>
    <img src={outfit.image_data_url} alt={`Active outfit: ${outfit.metadata.product_title}`} />
    <div><h3>{outfit.metadata.product_title}</h3><p>Product type: {outfit.metadata.product_type}</p></div>
    <p>Saved only in this browser on this device.</p>
    <a href={outfit.metadata.product_url} target="_blank" rel="noreferrer">View original product</a>
    <button className="secondary" disabled={busy} onClick={onReset}>Reset to original profile photo</button>
  </article>;
}

function ProductRow({ product }: { product: Product }) {
  const price = product.price && product.currency
    ? new Intl.NumberFormat(product.currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency: product.currency }).format(product.price)
    : "Price unavailable";
  return <article className="product row"><img src={product.image_url} alt="" /><div><h3>{product.title}</h3><p>{price}</p><a href={product.product_url} target="_blank" rel="noreferrer">View listing</a></div></article>;
}
