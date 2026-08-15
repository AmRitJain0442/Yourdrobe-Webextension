import { useEffect, useRef, useState } from "react";
import type { ExtractProductsResponse, Product, TryOnJob } from "../types";
import { getJob, startDemo, type NormalizedProduct } from "./api";

type Phase = "loading" | "needs-profile" | "ready" | "running" | "results" | "empty" | "error";
type Result = { product: NormalizedProduct; job: TryOnJob };
const profileKey = "yourdrobe_profile_image";
const unsupported = "Open a supported Amazon, Flipkart, or Nykaa listing page and try again.";
const maxPolls = 5;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("We could not read that image."));
    reader.readAsDataURL(file);
  });
}

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [products, setProducts] = useState<Product[]>([]);
  const [profileImage, setProfileImage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
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
      chrome.storage.local.get(profileKey),
    ]).then(([foundProducts, stored]) => {
      if (cancelled) return;
      const image = typeof stored[profileKey] === "string" ? stored[profileKey] : "";
      setProducts(foundProducts);
      setProfileImage(image);
      setPhase(foundProducts.length ? (image ? "ready" : "needs-profile") : "empty");
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setError(reason instanceof Error ? reason.message : unsupported);
      setPhase("error");
    });
    return () => {
      cancelled = true;
      activeRequest.current?.abort();
    };
  }, []);

  async function saveProfile() {
    if (!file || !consent) {
      setError("Choose an image and agree to local demo storage.");
      return;
    }
    try {
      const image = await readFile(file);
      await chrome.storage.local.set({ [profileKey]: image });
      setProfileImage(image);
      setError("");
      setPhase("ready");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We could not save that image.");
    }
  }

  async function runDemo() {
    activeRequest.current?.abort();
    const request = new AbortController();
    activeRequest.current = request;
    setPhase("running");
    setError("");
    try {
      const started = await startDemo(profileImage, products.slice(0, 5), request.signal);
      if (request.signal.aborted) return;
      let current = started.jobs;
      for (let polls = 0; current.some((job) => job.status === "queued" || job.status === "processing") && polls < maxPolls; polls += 1) {
        await delay(300);
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
      setError(reason instanceof Error ? reason.message : "The local backend is unavailable.");
      setPhase("error");
    } finally {
      if (activeRequest.current === request) activeRequest.current = null;
    }
  }

  return <main>
    <header><span className="eyebrow">Yourdrobe</span><h1>Your fitting room, anywhere.</h1></header>
    {phase === "loading" && <p role="status">Reading products from this page...</p>}
    {phase === "needs-profile" && <section>
      <h2>Create your local demo profile</h2>
      <p>Your image is stored in Chrome and sent only to the local demo backend for processing.</p>
      <label>Profile image<input type="file" accept="image/*" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
      <label className="check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />I agree to store this image locally for the demo.</label>
      {error && <p className="error" role="alert">{error}</p>}
      <button onClick={() => void saveProfile()}>Save profile</button>
    </section>}
    {phase === "ready" && <section>
      <h2>{products.length} products ready</h2>
      <div className="list">{products.map((product) => <ProductRow key={product.product_url} product={product} />)}</div>
      <button onClick={() => void runDemo()}>Try these products</button>
    </section>}
    {phase === "running" && <p role="status">Creating your mock previews...</p>}
    {phase === "empty" && <section><h2>No products found on this page.</h2><p>Browse a product listing or search results on this supported site, then retry.</p><button onClick={() => location.reload()}>Retry</button></section>}
    {phase === "results" && <section>
      <h2>Your previews</h2>
      <div className="list">{results.map(({ product, job }) => <article className="product" key={job.job_id}>
        <div><span className="badge">Mock AI preview</span><h3>{product.title}</h3></div>
        {job.status === "failed"
          ? <p className="error">This product preview failed. You can still view the original listing.</p>
          : <img src={job.result_url || product.image_url} alt={`Mock preview of ${product.title}`} />}
        <a className="button secondary" href={product.product_url} target="_blank" rel="noreferrer">View original product</a>
      </article>)}</div>
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
