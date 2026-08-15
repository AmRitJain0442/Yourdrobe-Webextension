from time import monotonic
from typing import TypeVar
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


class ProfileInput(BaseModel):
    session_id: str
    image_data_url: str
    consent: bool


class ProductInput(BaseModel):
    platform: str
    title: str = Field(min_length=1)
    brand: str | None = None
    price: float | None = None
    currency: str | None = None
    category: str = "other"
    image_url: str
    product_url: str
    metadata: dict[str, str] = Field(default_factory=dict)


class NormalizeInput(BaseModel):
    platform: str
    products: list[ProductInput]


class BatchInput(BaseModel):
    session_id: str
    profile_id: str
    product_ids: list[str] = Field(min_length=1, max_length=5)


app = FastAPI(title="Yourdrobe Demo API")
sessions: dict[str, None] = {}
profiles: dict[str, None] = {}
products: dict[str, dict] = {}
jobs: dict[str, dict] = {}
StoredValue = TypeVar("StoredValue")
MAX_STORED_ITEMS = 100  # ponytail: per-process demo cap; use persistent storage for a multi-user service
PLATFORM_HOSTS = {
    "amazon_in": "amazon.in",
    "amazon_us": "amazon.com",
    "flipkart": "flipkart.com",
    "nykaa": "nykaa.com",
}


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def remember(collection: dict[str, StoredValue], key: str, value: StoredValue) -> None:
    collection[key] = value
    if len(collection) > MAX_STORED_ITEMS:
        collection.pop(next(iter(collection)))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/v1/sessions")
def create_session() -> dict[str, str]:
    session_id = new_id("sess")
    remember(sessions, session_id, None)
    return {"session_id": session_id}


@app.post("/v1/profiles")
def create_profile(body: ProfileInput) -> dict[str, str]:
    if body.session_id not in sessions:
        raise HTTPException(404, "Session not found")
    if not body.consent:
        raise HTTPException(400, "Profile consent is required")
    if not body.image_data_url.startswith("data:image/"):
        raise HTTPException(400, "A valid image is required")
    profile_id = new_id("profile")
    remember(profiles, profile_id, None)
    return {"profile_id": profile_id, "status": "ready"}


@app.post("/v1/products/normalize")
def normalize_products(body: NormalizeInput) -> dict[str, list[dict]]:
    expected_host = PLATFORM_HOSTS.get(body.platform)
    if not expected_host:
        raise HTTPException(400, "Unsupported platform")
    normalized = []
    for product in body.products[:5]:
        try:
            parsed_url = urlparse(product.product_url)
            host = (parsed_url.hostname or "").removeprefix("www.")
        except ValueError:
            raise HTTPException(400, "Unsupported product host") from None
        if product.platform != body.platform or parsed_url.scheme != "https" or host != expected_host:
            raise HTTPException(400, "Unsupported product host")
        product_id = new_id("product")
        value = {"id": product_id, **product.model_dump()}
        remember(products, product_id, value)
        normalized.append(value)
    return {"products": normalized}


@app.post("/v1/tryons/batch")
def create_tryons(body: BatchInput) -> dict[str, list[dict]]:
    if body.session_id not in sessions or body.profile_id not in profiles:
        raise HTTPException(404, "Session or profile not found")
    created = []
    for product_id in body.product_ids:
        if product_id not in products:
            raise HTTPException(404, f"Product not found: {product_id}")
        job_id = new_id("tryon")
        remember(jobs, job_id, {
            "job_id": job_id,
            "product_id": product_id,
            "result_url": products[product_id]["image_url"],
            "created_at": monotonic(),
        })
        created.append({"job_id": job_id, "product_id": product_id, "status": "queued"})
    return {"jobs": created}


@app.get("/v1/tryons/{job_id}")
def get_tryon(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Try-on job not found")
    if monotonic() - job["created_at"] < 0.25:
        return {"job_id": job_id, "product_id": job["product_id"], "status": "processing", "progress": 50}
    return {
        "job_id": job_id,
        "product_id": job["product_id"],
        "status": "completed",
        "result_url": job["result_url"],
        "mock": True,
    }
