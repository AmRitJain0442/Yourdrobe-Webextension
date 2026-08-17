import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ExtractProductsResponse, Product, ProductType, TryOnJob } from "../types";
import { missingRequirements, requirementsForProducts, rolesForRequirement } from "../profile/requirements";
import { deleteActiveOutfit, LocalProfileAssetMissingError, loadActiveOutfit, loadLegacyImage, loadOutfitItems, loadOutfitVersions, loadProfile, loadRequiredAssets, removeOutfitItem, saveCompiledOutfit, saveYouCamConsent, selectOutfitVersion } from "../profile/store";
import type { ActiveOutfit, CompiledOutfit, OutfitItem, PhotoRole, ProfileMetadata, RequirementKey } from "../profile/types";
import CardFanCarousel from "../components/ui/card-fan-carousel";
import { getCapabilities, getJob, getResultImage, MissingProfileAssetsError, startDemo, type NormalizedProduct } from "./api";
import { ProfileSetup } from "./ProfileSetup";
import { ProfileManager } from "./ProfileManager";
import { YouCamConsent } from "./YouCamConsent";

type Phase = "loading" | "profile-setup" | "profile-manager" | "youcam-consent" | "ready" | "running" | "results" | "empty" | "error";
type AppTab = "try-on" | "wardrobe";
type LookView = "preview" | "active";
type Result = { product: NormalizedProduct; job: TryOnJob };
type FinalizeResult = { added: number; needs_attention: string[]; carts_opened: number; error?: string };
const unsupported = "Open a supported Amazon, Flipkart, or Nykaa listing page and try again.";
const maxPolls = 40;
const pollDelayMs = 2_000;
const pollDeadlineMs = 80_000;
const productPageSize = 25;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isResultUrl = (value?: string) => {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      || (url.origin === "http://127.0.0.1:8001" && /^\/v1\/tryons\/[^/]+\/result-image$/.test(url.pathname));
  }
  catch { return false; }
};
const selectableProductTypes: ProductType[] = [
  "makeup", "eyewear", "headwear", "earrings", "necklace", "top", "outerwear",
  "dress", "bottom", "belt", "bag", "watch", "bracelet", "ring", "footwear",
];
const activeOutfitProductTypes = new Set<ProductType>(selectableProductTypes);
type ShoeGender = "" | "female" | "male";
type SearchStore = Product["platform"];
const searchStores: { value: SearchStore; label: string; url: (query: string) => string }[] = [
  { value: "amazon_in", label: "Amazon India", url: (query) => `https://www.amazon.in/s?k=${query}` },
  { value: "amazon_us", label: "Amazon US", url: (query) => `https://www.amazon.com/s?k=${query}` },
  { value: "flipkart", label: "Flipkart", url: (query) => `https://www.flipkart.com/search?q=${query}` },
  { value: "nykaa", label: "Nykaa", url: (query) => `https://www.nykaa.com/search/result/?q=${query}` },
];
async function extractProducts(tabId?: number) {
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
  }
  if (!tabId) throw new Error(unsupported);
  try {
    const response = await chrome.tabs.sendMessage<unknown, ExtractProductsResponse>(tabId, { type: "EXTRACT_PRODUCTS" });
    if (!response.ok) throw new Error(response.error);
    return response.products;
  } catch {
    throw new Error(unsupported);
  }
}
const outfitItem = (product: Product): OutfitItem | null => product.product_type ? {
  platform: product.platform,
  title: product.title,
  product_type: product.product_type,
  product_url: product.product_url,
  image_url: product.image_url,
} : null;

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [activeTab, setActiveTab] = useState<AppTab>("try-on");
  const [lookView, setLookView] = useState<LookView>("active");
  const [products, setProducts] = useState<Product[]>([]);
  const [productPage, setProductPage] = useState(0);
  const [profile, setProfile] = useState<ProfileMetadata | null>(null);
  const [legacyImage, setLegacyImage] = useState<string | null>(null);
  const [activeOutfit, setActiveOutfit] = useState<ActiveOutfit | null>(null);
  const [outfitItems, setOutfitItems] = useState<OutfitItem[]>([]);
  const [outfitVersions, setOutfitVersions] = useState<CompiledOutfit[]>([]);
  const [missing, setMissing] = useState<RequirementKey[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [outfitBusy, setOutfitBusy] = useState(false);
  const [outfitStatus, setOutfitStatus] = useState("");
  const [outfitError, setOutfitError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchStore, setSearchStore] = useState<SearchStore>("amazon_in");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [finalizeBusy, setFinalizeBusy] = useState(false);
  const [finalizeStatus, setFinalizeStatus] = useState("");
  const [finalizeError, setFinalizeError] = useState("");
  const [shoeGenders, setShoeGenders] = useState<Record<string, ShoeGender>>({});
  const activeRequest = useRef<AbortController | null>(null);
  const pendingProducts = useRef<Product[]>([]);
  const outfitMutation = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void Promise.all([
      extractProducts(),
      loadProfile(),
      loadLegacyImage(),
      loadActiveOutfit(),
      loadOutfitItems(),
      loadOutfitVersions(),
    ]).then(([foundProducts, foundProfile, foundLegacyImage, foundActiveOutfit, foundOutfitItems, foundOutfitVersions]) => {
      if (cancelled) return;
      setProducts(foundProducts);
      setProductPage(0);
      if (foundProducts[0]) setSearchStore(foundProducts[0].platform);
      setProfile(foundProfile);
      setLegacyImage(foundLegacyImage);
      setActiveOutfit(foundActiveOutfit);
      setOutfitItems(foundOutfitItems);
      setOutfitVersions(foundOutfitVersions);
      setPhase(foundProducts.length ? "ready" : "empty");
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setError(reason instanceof Error ? reason.message : unsupported);
      setPhase("error");
    });
    const refreshAfterNavigation = (tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (!tab.active || changeInfo.status !== "complete") return;
      activeRequest.current?.abort();
      setPhase("loading");
      void extractProducts(tabId).then((foundProducts) => {
        if (cancelled) return;
        setProducts(foundProducts);
        setProductPage(0);
        pendingProducts.current = [];
        if (foundProducts[0]) setSearchStore(foundProducts[0].platform);
        setResults([]);
        setLookView("active");
        setError("");
        setPhase(foundProducts.length ? "ready" : "empty");
      }).catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : unsupported);
        setPhase("error");
      });
    };
    chrome.tabs.onUpdated.addListener(refreshAfterNavigation);
    return () => {
      cancelled = true;
      mounted.current = false;
      activeRequest.current?.abort();
      chrome.tabs.onUpdated.removeListener(refreshAfterNavigation);
    };
  }, []);

  async function reloadProfile() {
    const [nextProfile, nextLegacyImage, nextActiveOutfit, nextOutfitItems, nextOutfitVersions] = await Promise.all([loadProfile(), loadLegacyImage(), loadActiveOutfit(), loadOutfitItems(), loadOutfitVersions()]);
    setProfile(nextProfile);
    setLegacyImage(nextLegacyImage);
    setActiveOutfit(nextActiveOutfit);
    setOutfitItems(nextOutfitItems);
    setOutfitVersions(nextOutfitVersions);
  }

  async function searchProducts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query || searchBusy) return;
    setSearchBusy(true);
    setSearchError("");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active browser tab was found.");
      const store = searchStores.find((item) => item.value === searchStore) ?? searchStores[0];
      await chrome.tabs.update(tab.id, { url: store.url(encodeURIComponent(query)) });
      setResults([]);
      setLookView("active");
      setPhase("loading");
    } catch (reason) {
      setSearchError(reason instanceof Error ? reason.message : "Could not start the product search.");
    } finally {
      if (mounted.current) setSearchBusy(false);
    }
  }

  async function runDemo(currentProfile = profile, requestedProducts?: Product[]) {
    if (outfitMutation.current) return;
    if (requestedProducts) pendingProducts.current = requestedProducts;
    const candidates = requestedProducts ?? (pendingProducts.current.length ? pendingProducts.current : products.slice(0, 5));
    const selectedProducts = candidates.filter((product) => !activeOutfit || activeOutfitProductTypes.has(product.product_type ?? "unknown"));
    if (!selectedProducts.length) return;
    const outfitBaseImageDataUrl = activeOutfit && selectedProducts.some((product) => activeOutfitProductTypes.has(product.product_type ?? "unknown"))
      ? activeOutfit.image_data_url
      : undefined;
    const activeOutfitReplacesFullBody = Boolean(outfitBaseImageDataUrl);
    const availableRoles = Object.keys(currentProfile?.assets ?? {}) as PhotoRole[];
    if (activeOutfitReplacesFullBody) availableRoles.push("full_body_front");
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
      const usesCloudTryon = capabilities.tryon_provider !== "mock"
        && selectedProducts.some((product) => product.product_type && capabilities.live_product_types.includes(product.product_type));
      const hasProviderConsent = Boolean(currentProfile?.cloud_tryon_consented_at || currentProfile?.youcam_consented_at);
      if (usesCloudTryon && !hasProviderConsent) {
        setConsentError("");
        setPhase("youcam-consent");
        return;
      }
      const available = new Set(Object.keys(currentProfile?.assets ?? {}) as PhotoRole[]);
      const roles = requirementsForProducts(selectedProducts)
        .filter((requirement) => requirement !== "full_body_front" || !activeOutfitReplacesFullBody)
        .map((requirement) =>
        rolesForRequirement(requirement).find((role) => available.has(role)) ?? rolesForRequirement(requirement)[0],
      );
      const assets = await loadRequiredAssets(roles);
      const started = await startDemo(assets, currentProfile?.attributes ?? {}, selectedProducts, Boolean(currentProfile?.cloud_tryon_consented_at || currentProfile?.youcam_consented_at), outfitBaseImageDataUrl, request.signal);
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
      setLookView("preview");
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
        if (activeOutfitReplacesFullBody) repairedRoles.push("full_body_front");
        setMissing(missingRequirements(selectedProducts, repairedRoles));
        setPhase("profile-setup");
        return;
      }
      setError(reason instanceof Error ? reason.message : "The Yourdrobe service is unavailable.");
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
      const item = outfitItem(result.product);
      if (!item) throw new Error("Choose a supported product type before saving this outfit.");
      const saved = await saveCompiledOutfit(blob, {
        job_id: result.job.job_id,
        product_id: result.product.id,
        product_title: result.product.title,
        product_type: result.product.product_type ?? "unknown",
        product_url: result.product.product_url,
      }, item);
      if (!mounted.current) return;
      setActiveOutfit(saved.active);
      setOutfitItems(saved.items);
      setOutfitVersions(saved.outfits);
      setLookView("active");
      setOutfitStatus("Outfit version saved and selected.");
    } catch (reason) {
      if (!mounted.current) return;
      setLookView("active");
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
      setOutfitItems([]);
      setOutfitVersions([]);
      setLookView("preview");
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

  function previewProduct(product: Product) {
    let selected = product;
    if (product.product_type === "footwear" || product.product_type === "headwear") {
      const gender = shoeGenders[product.product_url];
      if (!gender) return;
      selected = { ...product, metadata: { ...product.metadata, gender } };
    }
    void runDemo(profile, [selected]);
  }

  async function removeSelectedProduct(productUrl: string) {
    if (outfitMutation.current || finalizeBusy) return;
    outfitMutation.current = true;
    setOutfitBusy(true);
    try {
      setOutfitItems(await removeOutfitItem(productUrl));
      setOutfitVersions(await loadOutfitVersions());
      setOutfitStatus("Product removed from outfit.");
    } catch (reason) {
      setOutfitError(reason instanceof Error ? reason.message : "We could not remove that product.");
    } finally {
      outfitMutation.current = false;
      if (mounted.current) setOutfitBusy(false);
    }
  }

  async function finalizeOutfit() {
    if (!outfitItems.length || finalizeBusy || outfitMutation.current) return;
    setFinalizeBusy(true);
    setFinalizeStatus("");
    setFinalizeError("");
    try {
      const result = await chrome.runtime.sendMessage<unknown, FinalizeResult>({ type: "FINALIZE_OUTFIT", items: outfitItems });
      if (!mounted.current) return;
      if (result.error) throw new Error(result.error);
      const cartText = result.carts_opened === 1 ? "The retailer cart is open." : `${result.carts_opened} retailer carts are open.`;
      const attention = result.needs_attention.length ? ` ${result.needs_attention.length} product pages need a size, colour, or other selection.` : "";
      setFinalizeStatus(`${result.added} products added. ${cartText}${attention}`);
    } catch (reason) {
      if (mounted.current) setFinalizeError(reason instanceof Error ? reason.message : "We could not finalize this outfit.");
    } finally {
      if (mounted.current) setFinalizeBusy(false);
    }
  }

  async function chooseOutfitVersion(index: number) {
    const version = outfitVersions[index];
    if (!version || version.metadata.job_id === activeOutfit?.metadata.job_id || outfitMutation.current || finalizeBusy) return;
    outfitMutation.current = true;
    setOutfitBusy(true);
    setOutfitError("");
    try {
      const selected = await selectOutfitVersion(version.metadata.job_id);
      if (!mounted.current) return;
      setActiveOutfit({ metadata: selected.metadata, image_data_url: selected.image_data_url });
      setOutfitItems(selected.items);
      setLookView("active");
      setOutfitStatus("Saved outfit selected.");
    } catch (reason) {
      if (mounted.current) setOutfitError(reason instanceof Error ? reason.message : "We could not select that saved outfit.");
    } finally {
      outfitMutation.current = false;
      if (mounted.current) setOutfitBusy(false);
    }
  }

  function openProfileManager() {
    if (!outfitMutation.current) setPhase("profile-manager");
  }

  const productPageCount = Math.ceil(products.length / productPageSize);
  const visibleProducts = products.slice(productPage * productPageSize, (productPage + 1) * productPageSize);
  const browsing = (["loading", "ready", "running", "results", "empty", "error"] as Phase[]).includes(phase);

  return <main>
    <header className="app-header"><div className="brand-mark" aria-hidden="true">Y</div><div><span className="eyebrow">Yourdrobe</span><h1>Your fitting room, anywhere.</h1></div><span className="header-sparkle" aria-hidden="true">✦</span></header>
    {phase === "profile-setup" && <ProfileSetup existingRoles={(Object.keys(profile?.assets ?? {}) as PhotoRole[]).filter((role) =>
      !missing.some((requirement) => rolesForRequirement(requirement).includes(role))
    )} onSaved={() => void reloadProfile().then(() => setPhase("ready"))} onCancel={() => setPhase("ready")} />}
    {phase === "profile-manager" && <ProfileManager profile={profile} legacyImage={legacyImage} onChanged={reloadProfile} onClose={() => setPhase(products.length ? "ready" : "empty")} />}
    {phase === "youcam-consent" && <div className="youcam-consent"><YouCamConsent busy={consentBusy} error={consentError} onAccept={() => void acceptYouCamConsent()} onCancel={() => setPhase("ready")} /></div>}
    {browsing && activeTab === "try-on" && <div className="tab-page" id="try-on-panel" role="tabpanel" aria-labelledby="try-on-tab">
      <section className="product-search" aria-labelledby="product-search-heading">
        <div className="section-heading"><div><span className="eyebrow">Discover</span><h2 id="product-search-heading">Find your next piece</h2></div><span aria-hidden="true">✦</span></div>
        <form onSubmit={(event) => void searchProducts(event)}>
          <label className="search-query">Search products<input type="search" required minLength={2} maxLength={100} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Try baggy jeans..." /></label>
          <label className="store-picker">Store<select aria-label="Marketplace" value={searchStore} onChange={(event) => setSearchStore(event.target.value as SearchStore)}>{searchStores.map((store) => <option key={store.value} value={store.value}>{store.label}</option>)}</select></label>
          <button className="search-button" disabled={searchBusy}><span className="sr-only">Search</span></button>
        </form>
        {searchError && <p className="error" role="alert">{searchError}</p>}
      </section>
      {(phase === "results" || (phase === "ready" && activeOutfit)) && <div className="look-stage">
        {phase === "results" && activeOutfit && <div className="look-toggle" role="group" aria-label="Choose fitting-room view">
          <button type="button" aria-pressed={lookView === "preview"} onClick={() => setLookView("preview")}>Preview</button>
          <button type="button" aria-pressed={lookView === "active"} onClick={() => setLookView("active")}>Active outfit</button>
        </div>}
        {phase === "results" && (!activeOutfit || lookView === "preview")
          ? <PreviewPanel results={results} busy={outfitBusy} onActivate={(result) => void useAsActiveOutfit(result)} />
          : activeOutfit && <ActiveOutfitPanel outfit={activeOutfit} outfits={outfitVersions} items={outfitItems} busy={outfitBusy || finalizeBusy} onSelect={(index) => void chooseOutfitVersion(index)} onRemove={(url) => void removeSelectedProduct(url)} onFinalize={() => void finalizeOutfit()} onReset={() => void resetActiveOutfit()} />}
      </div>}
      {phase === "running" && <p className="preview-loading" role="status">Creating your previews...</p>}
      {(phase === "ready" || phase === "results") && outfitStatus && <p className="outfit-message" role="status">{outfitStatus}</p>}
      {(phase === "ready" || phase === "results") && outfitError && <p className="error outfit-message" role="alert">{outfitError}</p>}
      {(phase === "ready" || phase === "results") && finalizeStatus && <p className="outfit-message" role="status">{finalizeStatus}</p>}
      {(phase === "ready" || phase === "results") && finalizeError && <p className="error outfit-message" role="alert">{finalizeError}</p>}
      {phase === "loading" && <section className="loading-state" aria-live="polite"><span aria-hidden="true">✦</span><p role="status">Reading products from this page...</p></section>}
      {(phase === "ready" || phase === "results") && <section className="catalog-section">
      <div className="section-heading"><div><span className="eyebrow">Shop this page</span><h2>{products.length} products ready</h2></div><span className="result-count">{productPage * productPageSize + 1}–{Math.min((productPage + 1) * productPageSize, products.length)}</span></div>
      <div className="list product-page">{visibleProducts.map((product, index) => <div className="catalog-item" key={product.product_url}><ProductRow product={product} />
        {(!product.product_type || product.product_type === "unknown") && <label>Choose product type for {product.title}<select required value={product.product_type ?? "unknown"} onChange={(event) => setProducts((current) => current.map((item, itemIndex) => itemIndex === productPage * productPageSize + index ? { ...item, product_type: event.target.value as ProductType } : item))}><option value="unknown">Choose product type</option>{selectableProductTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>}
        {(product.product_type === "footwear" || product.product_type === "headwear") && <label>{product.product_type === "footwear" ? "Shoe" : "Hat"} preview model<select aria-label={`${product.product_type === "footwear" ? "Shoe" : "Hat"} preview model`} value={shoeGenders[product.product_url] ?? ""} onChange={(event) => setShoeGenders((current) => ({ ...current, [product.product_url]: event.target.value as ShoeGender }))}><option value="">Choose Women or Men</option><option value="female">Women</option><option value="male">Men</option></select></label>}
        {product.product_type && product.product_type !== "unknown" && activeOutfitProductTypes.has(product.product_type) && <button className="ai-button" disabled={outfitBusy || ((product.product_type === "footwear" || product.product_type === "headwear") && !shoeGenders[product.product_url])} onClick={() => previewProduct(product)}>{product.product_type === "footwear" ? "Try these shoes" : `Try this ${product.product_type}`}</button>}
      </div>)}</div>
      {productPageCount > 1 && <nav className="product-pagination" aria-label="Product pages">
        <button className="secondary" disabled={productPage === 0} onClick={() => setProductPage((page) => page - 1)}>Previous page</button>
        <span aria-live="polite">Page {productPage + 1} of {productPageCount}</span>
        <button className="secondary" disabled={productPage + 1 === productPageCount} onClick={() => setProductPage((page) => page + 1)}>Next page</button>
      </nav>}
      </section>}
      {phase === "empty" && <section><h2>No products found on this page.</h2><p>Browse a product listing or search results on this supported site, then retry.</p><button onClick={() => location.reload()}>Retry</button></section>}
      {phase === "error" && <section><p className="error" role="alert">{error}</p><button onClick={() => location.reload()}>Retry</button></section>}
      {(["ready", "results", "empty", "error"] as Phase[]).includes(phase) && <button className="secondary manage-profile" disabled={outfitBusy} onClick={openProfileManager}>Manage profile</button>}
    </div>}
    {browsing && activeTab === "wardrobe" && <div className="tab-page" id="wardrobe-panel" role="tabpanel" aria-labelledby="wardrobe-tab">
      {activeOutfit && outfitVersions.length
        ? <ActiveOutfitPanel wardrobe outfit={activeOutfit} outfits={outfitVersions} items={outfitItems} busy={outfitBusy || finalizeBusy} onSelect={(index) => void chooseOutfitVersion(index)} onRemove={(url) => void removeSelectedProduct(url)} onFinalize={() => void finalizeOutfit()} onReset={() => void resetActiveOutfit()} />
        : <section className="wardrobe-empty"><span aria-hidden="true">◇</span><h2>Your wardrobe is empty</h2><p>Save a generated outfit to compare it here.</p><button onClick={() => setActiveTab("try-on")}>Start trying products</button></section>}
      {outfitStatus && <p className="outfit-message" role="status">{outfitStatus}</p>}
      {outfitError && <p className="error outfit-message" role="alert">{outfitError}</p>}
      {finalizeStatus && <p className="outfit-message" role="status">{finalizeStatus}</p>}
      {finalizeError && <p className="error outfit-message" role="alert">{finalizeError}</p>}
    </div>}
    {browsing && <nav className="bottom-nav" aria-label="Extension navigation">
      <button id="try-on-tab" className="try-on-tab" type="button" aria-current={activeTab === "try-on" ? "page" : undefined} aria-controls="try-on-panel" onClick={() => setActiveTab("try-on")}>Try on</button>
      <button id="wardrobe-tab" className="wardrobe-tab" type="button" aria-current={activeTab === "wardrobe" ? "page" : undefined} aria-controls="wardrobe-panel" onClick={() => setActiveTab("wardrobe")}>Wardrobe</button>
    </nav>}
  </main>;
}

function PreviewPanel({ results, busy, onActivate }: { results: Result[]; busy: boolean; onActivate: (result: Result) => void }) {
  return <section className="results-section">
    <div className="section-heading"><div><span className="eyebrow">AI fitting room</span><h2>Your previews</h2></div><span aria-hidden="true">✦</span></div>
    <div className="list preview-strip">{results.map(({ product, job }) => {
      const failed = job.status === "failed" || (job.mock === false && !isResultUrl(job.result_url));
      return <article className="product" key={job.job_id}>
        <div><span className="badge">{job.mock === false ? "Live AI preview" : "Mock AI preview"}</span><h3>{product.title}</h3></div>
        {failed
          ? <p className="error">{job.error_message ?? "This product preview failed. You can still view the original listing."}</p>
          : <img src={job.result_url || product.image_url} alt={`Preview of ${product.title}`} />}
        {job.status === "completed" && job.mock === false && isResultUrl(job.result_url) && <button className="ai-button" disabled={busy} onClick={() => onActivate({ product, job })}>Add this to active outfit</button>}
        <a className="button secondary" href={product.product_url} target="_blank" rel="noreferrer">View original product</a>
      </article>;
    })}</div>
  </section>;
}

function ActiveOutfitPanel({ outfit, outfits, items, busy, wardrobe = false, onSelect, onRemove, onFinalize, onReset }: { outfit: ActiveOutfit; outfits: CompiledOutfit[]; items: OutfitItem[]; busy: boolean; wardrobe?: boolean; onSelect: (index: number) => void; onRemove: (url: string) => void; onFinalize: () => void; onReset: () => void }) {
  const displayed = items.length ? items : [{ title: outfit.metadata.product_title, product_type: outfit.metadata.product_type, product_url: outfit.metadata.product_url }];
  const activeIndex = outfits.findIndex((saved) => saved.metadata.job_id === outfit.metadata.job_id);
  return <article className={`product active-outfit${wardrobe ? " wardrobe-panel" : ""}`} aria-labelledby={wardrobe ? "wardrobe-heading" : "active-outfit-heading"}>
    <div className="section-heading"><div><span className="eyebrow">{wardrobe ? `${outfits.length} saved ${outfits.length === 1 ? "look" : "looks"}` : "Your current look"}</span><h2 id={wardrobe ? "wardrobe-heading" : "active-outfit-heading"}>{wardrobe ? "Wardrobe" : "Active outfit"}</h2></div><span className="badge">✦ AI look</span></div>
    {wardrobe
      ? <CardFanCarousel cards={outfits.map((saved) => ({ id: saved.metadata.job_id, imgUrl: saved.image_data_url, alt: `Saved outfit ending with ${saved.metadata.product_title}` }))} activeIndex={activeIndex} onSelect={onSelect} />
      : <img src={outfit.image_data_url} alt={`Active outfit: ${outfit.metadata.product_title}`} />}
    <div><h3>{displayed.length} selected {displayed.length === 1 ? "product" : "products"}</h3><ul className="outfit-items">{displayed.map((item) => <li key={item.product_url}><span>{item.title} · {item.product_type}</span>{items.length > 0 && !activeOutfitProductTypes.has(item.product_type) && <button className="text-action" disabled={busy} aria-label={`Remove ${item.title}`} onClick={() => onRemove(item.product_url)}>Remove</button>}</li>)}</ul></div>
    <button disabled={busy || !items.length} onClick={onFinalize}>Finalize outfit in this tab</button>
    <a href={outfit.metadata.product_url} target="_blank" rel="noreferrer">View original product</a>
    <button className="secondary" disabled={busy} onClick={onReset}>Reset to original profile photo</button>
  </article>;
}

function ProductRow({ product }: { product: Product }) {
  const price = product.price && product.currency
    ? new Intl.NumberFormat(product.currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency: product.currency }).format(product.price)
    : "Price unavailable";
  return <article className="product catalog-card"><img src={product.image_url} alt={product.title} /><div><h3>{product.title}</h3><p className="price">{price}</p><a href={product.product_url} target="_blank" rel="noreferrer">View product</a></div></article>;
}
