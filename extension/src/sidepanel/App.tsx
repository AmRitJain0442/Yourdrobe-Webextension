import { useEffect, useRef, useState } from "react";
import type { ExtractProductsResponse, Product, ProductType, TryOnJob } from "../types";
import { missingRequirements, requirementsForProducts, rolesForRequirement } from "../profile/requirements";
import { LocalProfileAssetMissingError, loadLegacyImage, loadProfile, loadRequiredAssets, saveYouCamConsent } from "../profile/store";
import type { PhotoRole, ProfileMetadata, RequirementKey } from "../profile/types";
import { getCapabilities, getJob, MissingProfileAssetsError, startDemo, type NormalizedProduct } from "./api";
import { ProfileSetup } from "./ProfileSetup";
import { ProfileManager } from "./ProfileManager";
import { YouCamConsent } from "./YouCamConsent";

type Phase = "loading" | "profile-setup" | "profile-manager" | "youcam-consent" | "ready" | "running" | "results" | "empty" | "error";
type Result = { product: NormalizedProduct; job: TryOnJob };
const unsupported = "Open a supported Amazon, Flipkart, or Nykaa listing page and try again.";
const maxPolls = 40;
const pollDelayMs = 2_000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const selectableProductTypes: ProductType[] = [
  "makeup", "eyewear", "headwear", "earrings", "necklace", "top", "outerwear",
  "dress", "bottom", "belt", "bag", "watch", "bracelet", "ring", "footwear",
];

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [products, setProducts] = useState<Product[]>([]);
  const [profile, setProfile] = useState<ProfileMetadata | null>(null);
  const [legacyImage, setLegacyImage] = useState<string | null>(null);
  const [missing, setMissing] = useState<RequirementKey[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);
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
    ]).then(([foundProducts, foundProfile, foundLegacyImage]) => {
      if (cancelled) return;
      setProducts(foundProducts);
      setProfile(foundProfile);
      setLegacyImage(foundLegacyImage);
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
    const [nextProfile, nextLegacyImage] = await Promise.all([loadProfile(), loadLegacyImage()]);
    setProfile(nextProfile);
    setLegacyImage(nextLegacyImage);
  }

  async function runDemo(currentProfile = profile) {
    const selectedProducts = products.slice(0, 5);
    const required = missingRequirements(selectedProducts, Object.keys(currentProfile?.assets ?? {}) as PhotoRole[]);
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
      const roles = requirementsForProducts(selectedProducts).map((requirement) =>
        rolesForRequirement(requirement).find((role) => available.has(role)) ?? rolesForRequirement(requirement)[0],
      );
      const assets = await loadRequiredAssets(roles);
      const started = await startDemo(assets, currentProfile?.attributes ?? {}, selectedProducts, Boolean(currentProfile?.youcam_consented_at), request.signal);
      if (request.signal.aborted) return;
      let current = started.jobs;
      for (let polls = 0; current.some((job) => job.status === "queued" || job.status === "processing") && polls < maxPolls; polls += 1) {
        await delay(pollDelayMs);
        if (request.signal.aborted) return;
        current = await Promise.all(current.map((job) =>
          job.status === "completed" || job.status === "failed" ? job : getJob(job.job_id, request.signal),
        ));
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
      if (reason instanceof MissingProfileAssetsError) {
        setMissing(reason.roles);
        setPhase("profile-setup");
        return;
      }
      if (reason instanceof LocalProfileAssetMissingError) {
        const repaired = await loadProfile();
        setProfile(repaired);
        setMissing(missingRequirements(selectedProducts, Object.keys(repaired?.assets ?? {}) as PhotoRole[]));
        setPhase("profile-setup");
        return;
      }
      setError(reason instanceof Error ? reason.message : "The local backend is unavailable.");
      setPhase("error");
    } finally {
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

  return <main>
    <header><span className="eyebrow">Yourdrobe</span><h1>Your fitting room, anywhere.</h1></header>
    {phase === "loading" && <p role="status">Reading products from this page...</p>}
    {phase === "profile-setup" && <ProfileSetup requirements={missing} productTypes={products.map((product) => product.product_type ?? "unknown")} onSaved={() => void loadProfile().then((next) => { setProfile(next); setPhase("ready"); })} onCancel={() => setPhase("ready")} />}
    {phase === "profile-manager" && <ProfileManager profile={profile} legacyImage={legacyImage} onChanged={reloadProfile} onClose={() => setPhase(products.length ? "ready" : "empty")} />}
    {phase === "youcam-consent" && <div className="youcam-consent"><YouCamConsent busy={consentBusy} error={consentError} onAccept={() => void acceptYouCamConsent()} onCancel={() => setPhase("ready")} /></div>}
    {phase === "ready" && <section>
      <h2>{products.length} products ready</h2>
      <div className="list">{products.map((product, index) => <div key={product.product_url}><ProductRow product={product} />
        {(!product.product_type || product.product_type === "unknown") && <label>Choose product type for {product.title}<select required value={product.product_type ?? "unknown"} onChange={(event) => setProducts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, product_type: event.target.value as ProductType } : item))}><option value="unknown">Choose product type</option>{selectableProductTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>}
      </div>)}</div>
      <button disabled={products.some((product) => !product.product_type || product.product_type === "unknown")} onClick={() => void runDemo()}>Try these products</button>
      <button className="secondary" onClick={() => setPhase("profile-manager")}>Manage profile</button>
    </section>}
    {phase === "running" && <p role="status">Creating your mock previews...</p>}
    {phase === "empty" && <section><h2>No products found on this page.</h2><p>Browse a product listing or search results on this supported site, then retry.</p><button onClick={() => location.reload()}>Retry</button></section>}
    {phase === "results" && <section>
      <h2>Your previews</h2>
      <div className="list">{results.map(({ product, job }) => <article className="product" key={job.job_id}>
        <div><span className="badge">{job.mock === false ? "YouCam AI preview" : "Mock AI preview"}</span><h3>{product.title}</h3></div>
        {job.status === "failed"
          ? <p className="error">{job.error_message ?? "This product preview failed. You can still view the original listing."}</p>
          : <img src={job.result_url || product.image_url} alt={`Mock preview of ${product.title}`} />}
        <a className="button secondary" href={product.product_url} target="_blank" rel="noreferrer">View original product</a>
      </article>)}</div>
      <button className="secondary" onClick={() => setPhase("profile-manager")}>Manage profile</button>
    </section>}
    {phase === "error" && <section><p className="error" role="alert">{error}</p><button onClick={() => location.reload()}>Retry</button></section>}
  </main>;
}

function ProductRow({ product }: { product: Product }) {
  const price = product.price && product.currency
    ? new Intl.NumberFormat(product.currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency: product.currency }).format(product.price)
    : "Price unavailable";
  return <article className="product row"><img src={product.image_url} alt="" /><div><h3>{product.title}</h3><p>{price}</p><a href={product.product_url} target="_blank" rel="noreferrer">View listing</a></div></article>;
}
