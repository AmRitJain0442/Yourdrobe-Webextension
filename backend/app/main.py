from time import monotonic
from typing import Literal, TypeVar
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field, StrictBool, field_validator

from app.youcam import ProviderTaskState, YouCamClient, YouCamFailure
from app.profile_generation import NanoBananaClient, ProfileGenerationFailure


PhotoRole = Literal[
    "face_front", "face_left", "face_right", "upper_body_front", "upper_body_side",
    "full_body_front", "full_body_side", "left_hand_wrist", "right_hand_wrist",
    "feet_front", "feet_side_top",
]


class ProfileAssetInput(BaseModel):
    kind: PhotoRole
    image_data_url: str = Field(min_length=1, max_length=14_000_000)


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
    assets: list[ProfileAssetInput] = Field(default_factory=list, max_length=11)
    attributes: ProfileAttributesInput = Field(default_factory=ProfileAttributesInput)
    consent: bool


class GenerateProfileInput(BaseModel):
    image_data_url: str = Field(min_length=1, max_length=14_000_000)
    cloud_consent: StrictBool = False


class ProductInput(BaseModel):
    platform: str
    title: str = Field(min_length=1, max_length=300)
    brand: str | None = None
    price: float | None = None
    currency: str | None = None
    category: str = "other"
    product_type: Literal[
        "makeup", "eyewear", "headwear", "earrings", "necklace", "top", "outerwear",
        "dress", "bottom", "belt", "bag", "watch", "bracelet", "ring", "footwear", "unknown",
    ] = "unknown"
    image_url: str = Field(min_length=1, max_length=2048)
    product_url: str = Field(min_length=1, max_length=2048)
    metadata: dict[str, str] = Field(default_factory=dict)


class NormalizeInput(BaseModel):
    platform: str
    products: list[ProductInput]


class BatchInput(BaseModel):
    session_id: str
    profile_id: str
    product_ids: list[str] = Field(min_length=1, max_length=5)
    assets: list[ProfileAssetInput] = Field(default_factory=list, max_length=11)
    cloud_consent: StrictBool = False
    outfit_base_image_data_url: str | None = Field(default=None, max_length=14_000_000)

    @field_validator("outfit_base_image_data_url")
    @classmethod
    def validate_outfit_base_image(cls, value: str | None) -> str | None:
        if value is not None and not value.startswith(("data:image/jpeg;base64,", "data:image/png;base64,")):
            raise ValueError("Active outfit must be a JPEG or PNG data URL")
        return value


app = FastAPI(title="Yourdrobe Demo API")
sessions: dict[str, None] = {}
profiles: dict[str, set[str]] = {}
products: dict[str, dict] = {}
jobs: dict[str, dict] = {}
youcam = YouCamClient.from_environment()
profile_generator = NanoBananaClient.from_environment()
StoredValue = TypeVar("StoredValue")
MAX_STORED_ITEMS = 100  # ponytail: per-process demo cap; use persistent storage for a multi-user service
PLATFORM_HOSTS = {
    "amazon_in": "amazon.in",
    "amazon_us": "amazon.com",
    "flipkart": "flipkart.com",
    "nykaa": "nykaa.com",
}
PRODUCT_REQUIREMENTS = {
    "makeup": (("full_body_front",),),
    "eyewear": (("full_body_front",),),
    "headwear": (("full_body_front",),),
    "earrings": (("full_body_front",),),
    "necklace": (("full_body_front",),),
    "top": (("full_body_front",),),
    "outerwear": (("full_body_front",),),
    "dress": (("full_body_front",),),
    "bottom": (("full_body_front",),),
    "belt": (("full_body_front",),),
    "bag": (("full_body_front",),),
    "watch": (("full_body_front",),),
    "bracelet": (("full_body_front",),),
    "ring": (("full_body_front",),),
    "footwear": (("full_body_front",),),
}
YOUCAM_TYPES = ["top", "outerwear", "bottom", "dress", "footwear"]
YOUCAM_MAPPING = {
    "top": ("full_body_front", "upper_body"),
    "outerwear": ("full_body_front", "upper_body"),
    "bottom": ("full_body_front", "lower_body"),
    "dress": ("full_body_front", "full_body"),
    "footwear": ("full_body_front", "shoes"),
}
GOOGLE_TYPES = [
    "makeup", "eyewear", "headwear", "earrings", "necklace", "belt", "bag", "watch", "bracelet", "ring",
]
GOOGLE_MAPPING = {product_type: "full_body_front" for product_type in GOOGLE_TYPES}
ALL_LIVE_TYPES = [
    "makeup", "eyewear", "headwear", "earrings", "necklace", "top", "outerwear", "dress", "bottom",
    "belt", "bag", "watch", "bracelet", "ring", "footwear",
]


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def remember(collection: dict[str, StoredValue], key: str, value: StoredValue) -> None:
    collection[key] = value
    if len(collection) > MAX_STORED_ITEMS:
        collection.pop(next(iter(collection)))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/capabilities")
def capabilities() -> dict[str, object]:
    google_enabled = bool(getattr(profile_generator, "tryon_enabled", False))
    live_types = [
        product_type for product_type in ALL_LIVE_TYPES
        if (product_type in YOUCAM_MAPPING and youcam.enabled) or (product_type in GOOGLE_MAPPING and google_enabled)
    ]
    provider = "hybrid" if youcam.enabled and google_enabled else "youcam" if youcam.enabled else "google" if google_enabled else "mock"
    return {
        "tryon_provider": provider,
        "live_product_types": live_types,
        "youcam_product_types": YOUCAM_TYPES if youcam.enabled else [],
        "google_product_types": GOOGLE_TYPES if google_enabled else [],
    }


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


@app.post("/v1/profiles/generate-assets")
def generate_profile_assets(body: GenerateProfileInput) -> dict[str, object]:
    if not body.cloud_consent:
        raise HTTPException(400, "Google cloud-processing consent is required")
    if not profile_generator.enabled:
        raise HTTPException(503, "AI profile generation is not configured")
    try:
        assets = profile_generator.generate(body.image_data_url)
    except ProfileGenerationFailure as failure:
        raise HTTPException(502, str(failure)) from None
    return {"assets": assets, "generated": True}


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
            if (
                body.outfit_base_image_data_url
                and product["product_type"] in (YOUCAM_MAPPING | GOOGLE_MAPPING)
                and "full_body_front" in alternatives
            ):
                continue
            if not any(role in profile_roles for role in alternatives):
                missing.add(
                    "hand_wrist"
                    if set(alternatives) == {"left_hand_wrist", "right_hand_wrist"}
                    else alternatives[0]
                )
    if missing:
        raise HTTPException(422, {"code": "missing_profile_assets", "roles": sorted(missing)})

    google_enabled = bool(getattr(profile_generator, "tryon_enabled", False))
    if not youcam.enabled and not google_enabled:
        created = []
        for product_id, product in zip(body.product_ids, resolved_products):
            job_id = new_id("tryon")
            remember(jobs, job_id, {
                "job_id": job_id,
                "product_id": product_id,
                "result_url": product["image_url"],
                "created_at": monotonic(),
                "mock": True,
            })
            created.append({"job_id": job_id, "product_id": product_id, "status": "queued"})
        return {"jobs": created}

    has_supported_product = any(
        (product["product_type"] in YOUCAM_MAPPING and youcam.enabled)
        or (product["product_type"] in GOOGLE_MAPPING and google_enabled)
        for product in resolved_products
    )
    if has_supported_product and not body.cloud_consent:
        raise HTTPException(400, {"code": "live_consent_required"})
    asset_by_role = {asset.kind: asset.image_data_url for asset in body.assets}
    missing = set()
    if not body.outfit_base_image_data_url:
        for product in resolved_products:
            product_type = product["product_type"]
            role = (
                YOUCAM_MAPPING[product_type][0]
                if youcam.enabled and product_type in YOUCAM_MAPPING
                else GOOGLE_MAPPING.get(product_type) if google_enabled else None
            )
            if role and role not in asset_by_role:
                missing.add(role)
    if missing:
        raise HTTPException(422, {"code": "missing_profile_assets", "roles": sorted(missing)})

    created = []
    for product_id, product in zip(body.product_ids, resolved_products):
        job_id = new_id("tryon")
        product_type = product["product_type"]
        mapping = YOUCAM_MAPPING.get(product_type) if youcam.enabled else None
        google_role = GOOGLE_MAPPING.get(product_type) if google_enabled else None
        if mapping:
            try:
                source = body.outfit_base_image_data_url or asset_by_role[mapping[0]]
                if product_type == "footwear":
                    started = youcam.create_shoes_task(
                        source, product["image_url"], product.get("metadata", {}).get("gender", ""),
                    )
                else:
                    started = youcam.create_clothes_task(source, product["image_url"], mapping[1])
            except YouCamFailure as failure:
                job = {
                    "job_id": job_id,
                    "product_id": product_id,
                    "error_code": failure.code,
                    "error_message": str(failure),
                    "mock": False,
                }
            else:
                job = {
                    "job_id": job_id,
                    "product_id": product_id,
                    "provider_task_id": started.task_id,
                    "provider_key_index": started.key_index,
                    "provider_task_kind": started.task_kind,
                    "mock": False,
                }
        elif google_role:
            try:
                source = body.outfit_base_image_data_url or asset_by_role[google_role]
                result_mime, result_bytes = profile_generator.generate_tryon(
                    source, product["image_url"], product["title"], product_type,
                )
            except ProfileGenerationFailure as failure:
                job = {
                    "job_id": job_id,
                    "product_id": product_id,
                    "error_code": "google_tryon_failed",
                    "error_message": str(failure),
                    "mock": False,
                }
            else:
                job = {
                    "job_id": job_id,
                    "product_id": product_id,
                    "provider": "google",
                    "result_bytes": result_bytes,
                    "result_mime": result_mime,
                    "result_url": f"http://127.0.0.1:8001/v1/tryons/{job_id}/result-image",
                    "completed": True,
                    "mock": False,
                }
        else:
            job = {
                "job_id": job_id,
                "product_id": product_id,
                "error_code": "unsupported_live_category",
                "error_message": "Live try-on is not available for this product type.",
                "mock": False,
            }
        remember(jobs, job_id, job)
        created.append({
            "job_id": job_id,
            "product_id": product_id,
            "status": "failed" if "error_code" in job else "completed" if job.get("completed") else "queued",
            **({
                "error_code": job["error_code"],
                "error_message": job["error_message"],
                "mock": False,
            } if "error_code" in job else {"result_url": job["result_url"], "mock": False} if job.get("completed") else {}),
        })
    return {"jobs": created}


@app.get("/v1/tryons/{job_id}")
def get_tryon(job_id: str) -> dict:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Try-on job not found")
    if job["mock"] and monotonic() - job["created_at"] < 0.25:
        return {"job_id": job_id, "product_id": job["product_id"], "status": "processing", "progress": 50}
    if job["mock"]:
        return {
            "job_id": job_id,
            "product_id": job["product_id"],
            "status": "completed",
            "result_url": job["result_url"],
            "mock": True,
        }
    if job.get("provider") == "google" and job.get("completed") is True:
        return {
            "job_id": job_id,
            "product_id": job["product_id"],
            "status": "completed",
            "result_url": job["result_url"],
            "mock": False,
        }
    if "error_code" in job:
        return {
            "job_id": job_id,
            "product_id": job["product_id"],
            "status": "failed",
            "error_code": job["error_code"],
            "error_message": job["error_message"],
            "mock": False,
        }
    if job.get("completed") is True:
        return {
            "job_id": job_id,
            "product_id": job["product_id"],
            "status": "completed",
            "result_url": job["result_url"],
            "mock": False,
        }
    state: ProviderTaskState = youcam.get_task(
        job["provider_task_id"], job["provider_key_index"], job.get("provider_task_kind", "clothes"),
    )
    if state.status == "processing":
        return {"job_id": job_id, "product_id": job["product_id"], "status": "processing", "progress": 50, "mock": False}
    if state.status == "completed":
        job["result_url"] = state.result_url
        job["completed"] = True
        return {
            "job_id": job_id,
            "product_id": job["product_id"],
            "status": "completed",
            "result_url": state.result_url,
            "mock": False,
        }
    return {
        "job_id": job_id,
        "product_id": job["product_id"],
        "status": "failed",
        "error_code": state.error_code or "provider_processing_failed",
        "error_message": state.error_message or "YouCam could not complete this preview.",
        "mock": False,
    }


@app.get("/v1/tryons/{job_id}/result-image")
def get_tryon_result_image(job_id: str) -> Response:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Try-on job not found")
    if job.get("provider") == "google" and job.get("completed") is True:
        return Response(content=job["result_bytes"], media_type=job["result_mime"])
    if not (
        job.get("mock") is False
        and job.get("completed") is True
        and isinstance(job.get("result_url"), str)
    ):
        raise HTTPException(409, "Try-on result is not available")
    try:
        content, media_type = youcam.download_result(job["result_url"])
    except YouCamFailure as failure:
        raise HTTPException(502, {"code": failure.code, "message": str(failure)}) from None
    return Response(content=content, media_type=media_type)
