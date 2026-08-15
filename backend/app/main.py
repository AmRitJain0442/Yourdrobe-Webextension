from time import monotonic
from typing import Literal, TypeVar
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


PhotoRole = Literal[
    "face_front", "face_left", "face_right", "upper_body_front", "upper_body_side",
    "full_body_front", "full_body_side", "left_hand_wrist", "right_hand_wrist",
    "feet_front", "feet_side_top",
]


class ProfileAssetInput(BaseModel):
    kind: PhotoRole
    image_data_url: str


class ProfileAttributesInput(BaseModel):
    height_cm: float | None = None
    top_size: str | None = None
    bottom_size: str | None = None
    dress_size: str | None = None
    chest_cm: float | None = None
    waist_cm: float | None = None
    hips_cm: float | None = None
    inseam_cm: float | None = None
    skin_tone: str | None = None
    undertone: str | None = None
    shoe_size_system: str | None = None
    shoe_size: str | None = None
    ring_size: str | None = None
    left_wrist_cm: float | None = None
    right_wrist_cm: float | None = None


class ProfileInput(BaseModel):
    session_id: str
    assets: list[ProfileAssetInput] = Field(min_length=1, max_length=11)
    attributes: ProfileAttributesInput = Field(default_factory=ProfileAttributesInput)
    consent: bool


class ProductInput(BaseModel):
    platform: str
    title: str = Field(min_length=1)
    brand: str | None = None
    price: float | None = None
    currency: str | None = None
    category: str = "other"
    product_type: Literal[
        "makeup", "eyewear", "headwear", "earrings", "necklace", "top", "outerwear",
        "dress", "bottom", "belt", "bag", "watch", "bracelet", "ring", "footwear", "unknown",
    ] = "unknown"
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
profiles: dict[str, set[str]] = {}
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
PRODUCT_REQUIREMENTS = {
    "makeup": (("face_front",),),
    "eyewear": (("face_front",),),
    "headwear": (("face_front",),),
    "earrings": (("face_front",),),
    "necklace": (("upper_body_front",),),
    "top": (("upper_body_front",),),
    "outerwear": (("upper_body_front",),),
    "dress": (("full_body_front",),),
    "bottom": (("full_body_front",),),
    "belt": (("full_body_front",),),
    "bag": (("full_body_front",),),
    "watch": (("left_hand_wrist", "right_hand_wrist"),),
    "bracelet": (("left_hand_wrist", "right_hand_wrist"),),
    "ring": (("left_hand_wrist", "right_hand_wrist"),),
    "footwear": (("feet_front",),),
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
def create_profile(body: ProfileInput) -> dict[str, object]:
    if body.session_id not in sessions:
        raise HTTPException(404, "Session not found")
    if not body.consent:
        raise HTTPException(400, "Profile consent is required")
    roles = [asset.kind for asset in body.assets]
    if len(set(roles)) != len(roles):
        raise HTTPException(400, "Profile asset roles must be unique")
    if any(not asset.image_data_url.startswith("data:image/") for asset in body.assets):
        raise HTTPException(400, "Every profile asset must be a valid image")
    profile_id = new_id("profile")
    remember(profiles, profile_id, set(roles))
    return {"profile_id": profile_id, "status": "ready", "roles": roles}


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
    resolved_products = []
    for product_id in body.product_ids:
        if product_id not in products:
            raise HTTPException(404, f"Product not found: {product_id}")
        resolved_products.append(products[product_id])

    missing = set()
    profile_roles = profiles[body.profile_id]
    for product in resolved_products:
        for alternatives in PRODUCT_REQUIREMENTS.get(product["product_type"], ()):
            if not any(role in profile_roles for role in alternatives):
                missing.add(
                    "hand_wrist"
                    if set(alternatives) == {"left_hand_wrist", "right_hand_wrist"}
                    else alternatives[0]
                )
    if missing:
        raise HTTPException(422, {"code": "missing_profile_assets", "roles": sorted(missing)})

    created = []
    for product_id, product in zip(body.product_ids, resolved_products):
        job_id = new_id("tryon")
        remember(jobs, job_id, {
            "job_id": job_id,
            "product_id": product_id,
            "result_url": product["image_url"],
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
