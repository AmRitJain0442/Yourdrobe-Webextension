from dataclasses import dataclass
import base64
import os
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv


API_BASE = "https://yce-api-01.makeupar.com"
CLOTH_FILE_PATH = "/s2s/v2.0/file/cloth-v3"
CLOTH_TASK_PATH = "/s2s/v2.0/task/cloth-v3"
SHOES_FILE_PATH = "/s2s/v2.0/file/shoes"
SHOES_TASK_PATH = "/s2s/v2.0/task/shoes"
RETRYABLE_HTTP = {401, 403, 429}
PROVIDER_TIMEOUT_SECONDS = 5.0
MAX_IMAGE_BYTES = 10 * 1024 * 1024
ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
GarmentCategory = Literal["upper_body", "lower_body", "full_body"]
TaskKind = Literal["clothes", "shoes"]


@dataclass(frozen=True)
class StartedTask:
    task_id: str
    key_index: int
    task_kind: TaskKind = "clothes"


@dataclass(frozen=True)
class ProviderTaskState:
    status: Literal["processing", "completed", "failed"]
    result_url: str | None = None
    error_code: str | None = None
    error_message: str | None = None


class YouCamFailure(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class YouCamClient:
    def __init__(self, keys: tuple[str, ...], client: httpx.Client | None = None) -> None:
        self._keys = keys
        self._client = client or httpx.Client(timeout=PROVIDER_TIMEOUT_SECONDS)

    @classmethod
    def from_environment(cls) -> "YouCamClient":
        load_dotenv(ENV_FILE, override=False)
        return cls.from_value(os.getenv("YOUCAM_API_KEYS", ""))

    @classmethod
    def from_value(cls, value: str, client: httpx.Client | None = None) -> "YouCamClient":
        keys = tuple(dict.fromkeys(item.strip() for item in value.split(",") if item.strip()))
        return cls(keys, client)

    @property
    def enabled(self) -> bool:
        return bool(self._keys)

    @property
    def key_count(self) -> int:
        return len(self._keys)

    def create_clothes_task(
        self,
        source_data_url: str,
        reference_url: str,
        garment_category: GarmentCategory,
    ) -> StartedTask:
        if garment_category not in ("upper_body", "lower_body", "full_body"):
            raise YouCamFailure("provider_processing_failed", "YouCam could not create this preview.")
        return self._create_task(
            source_data_url, reference_url, CLOTH_FILE_PATH, CLOTH_TASK_PATH,
            {"garment_category": garment_category}, "clothes",
        )

    def create_shoes_task(self, source_data_url: str, reference_url: str, gender: str) -> StartedTask:
        if gender not in ("female", "male"):
            raise YouCamFailure("provider_processing_failed", "Choose a shoe preview model.")
        return self._create_task(
            source_data_url, reference_url, SHOES_FILE_PATH, SHOES_TASK_PATH,
            {"gender": gender, "style": "random"}, "shoes",
        )

    def _create_task(
        self,
        source_data_url: str,
        reference_url: str,
        file_path: str,
        task_path: str,
        parameters: dict[str, str],
        task_kind: TaskKind,
    ) -> StartedTask:
        image, content_type, extension = self._image(source_data_url)
        if not self._is_https(reference_url):
            raise YouCamFailure("invalid_product_image", "YouCam could not use this product image.")
        all_rate_limited = True
        for key_index, key in enumerate(self._keys):
            headers = {"Authorization": f"Bearer {key}"}
            try:
                metadata = self._client.post(
                    f"{API_BASE}{file_path}", headers=headers, json={"files": [{
                        "content_type": content_type,
                        "file_name": f"source.{extension}",
                        "file_size": len(image),
                    }]},
                )
                if self._retryable(metadata):
                    all_rate_limited = all_rate_limited and metadata.status_code == 429
                    continue
                if metadata.is_error:
                    raise self._failure_from_response(metadata, "invalid_user_image")
                upload = self._upload_details(metadata)
                uploaded = self._client.put(upload[1], headers=upload[2], content=image)
                if self._retryable(uploaded):
                    all_rate_limited = all_rate_limited and uploaded.status_code == 429
                    continue
                if uploaded.is_error:
                    raise YouCamFailure("invalid_user_image", "YouCam could not use this user image.")
                created = self._client.post(f"{API_BASE}{task_path}", headers=headers, json={
                    "src_file_id": upload[0], "ref_file_url": reference_url, **parameters,
                })
                if self._retryable(created):
                    all_rate_limited = all_rate_limited and created.status_code == 429
                    continue
                if created.is_error:
                    raise self._failure_from_response(created, "invalid_product_image")
                task_id = self._data(created).get("task_id")
                if isinstance(task_id, str) and task_id.strip():
                    return StartedTask(task_id.strip(), key_index, task_kind)
                raise YouCamFailure("provider_processing_failed", "YouCam could not create this preview.")
            except httpx.RequestError:
                all_rate_limited = False
                continue
        if all_rate_limited and self._keys:
            raise YouCamFailure("youcam_rate_limited", "YouCam is rate limited. Please try again later.")
        raise YouCamFailure("youcam_keys_exhausted", "YouCam is temporarily unavailable.")

    def get_task(self, task_id: str, key_index: int, task_kind: TaskKind = "clothes") -> ProviderTaskState:
        if not 0 <= key_index < len(self._keys):
            return self._failed("provider_processing_failed")
        task_path = CLOTH_TASK_PATH if task_kind == "clothes" else SHOES_TASK_PATH if task_kind == "shoes" else None
        if task_path is None:
            return self._failed("provider_processing_failed")
        try:
            response = self._client.get(
                f"{API_BASE}{task_path}/{task_id}", headers={"Authorization": f"Bearer {self._keys[key_index]}"},
            )
        except httpx.RequestError:
            return ProviderTaskState(status="processing")
        if self._retryable(response):
            return ProviderTaskState(status="processing")
        if response.is_error:
            return self._failed(self._error_code(response, "provider_processing_failed"))
        data = self._data(response)
        if data.get("task_status") == "success":
            result = data.get("results")
            if isinstance(result, dict) and isinstance(result.get("url"), str) and self._is_https(result["url"]):
                return ProviderTaskState(status="completed", result_url=result["url"])
            return self._failed("provider_processing_failed")
        if data.get("task_status") == "error":
            return self._failed(self._error_code(response, "provider_processing_failed"))
        return ProviderTaskState(status="processing")

    def download_result(self, url: str) -> tuple[bytes, str]:
        failure = YouCamFailure(
            "provider_result_unavailable", "This YouCam result is no longer available.",
        )
        try:
            parsed = urlparse(url)
            hostname = parsed.hostname or ""
            if (
                parsed.scheme != "https"
                or not hostname.startswith("yce-")
                or not hostname.endswith(".s3-accelerate.amazonaws.com")
            ):
                raise failure
            with self._client.stream("GET", url, follow_redirects=False) as response:
                content_type = response.headers.get("content-type", "").partition(";")[0].strip().lower()
                if response.status_code != 200 or content_type not in ("image/jpeg", "image/png"):
                    raise failure
                content = bytearray()
                for chunk in response.iter_bytes():
                    content.extend(chunk)
                    if len(content) >= MAX_IMAGE_BYTES:
                        raise failure
                return bytes(content), content_type
        except (httpx.HTTPError, ValueError):
            raise failure from None

    @staticmethod
    def _is_https(value: str) -> bool:
        try:
            parsed = urlparse(value)
        except ValueError:
            return False
        return parsed.scheme == "https" and bool(parsed.hostname)

    @staticmethod
    def _retryable(response: httpx.Response) -> bool:
        return response.status_code in RETRYABLE_HTTP or 500 <= response.status_code < 600

    @staticmethod
    def _data(response: httpx.Response) -> dict:
        try:
            data = response.json().get("data", {})
        except (ValueError, AttributeError):
            return {}
        return data if isinstance(data, dict) else {}

    def _image(self, value: str) -> tuple[bytes, str, str]:
        prefix, marker, encoded = value.partition(",")
        details = {
            "data:image/jpeg;base64": ("image/jpg", "jpg"),
            "data:image/png;base64": ("image/png", "png"),
        }.get(prefix)
        if not marker or not details:
            raise YouCamFailure("invalid_user_image", "YouCam could not use this user image.")
        try:
            image = base64.b64decode(encoded, validate=True)
        except ValueError:
            raise YouCamFailure("invalid_user_image", "YouCam could not use this user image.") from None
        if not image or len(image) >= MAX_IMAGE_BYTES:
            raise YouCamFailure("invalid_user_image", "YouCam could not use this user image.")
        return image, *details

    def _upload_details(self, response: httpx.Response) -> tuple[str, str, dict[str, str]]:
        files = self._data(response).get("files")
        if not isinstance(files, list) or not files or not isinstance(files[0], dict):
            raise YouCamFailure("provider_processing_failed", "YouCam could not create this preview.")
        requests = files[0].get("requests")
        if not isinstance(requests, list) or not requests or not isinstance(requests[0], dict):
            raise YouCamFailure("provider_processing_failed", "YouCam could not create this preview.")
        file_id, url, headers = files[0].get("file_id"), requests[0].get("url"), requests[0].get("headers")
        if not isinstance(file_id, str) or not isinstance(url, str) or not isinstance(headers, dict):
            raise YouCamFailure("provider_processing_failed", "YouCam could not create this preview.")
        return file_id, url, {str(key): str(value) for key, value in headers.items()}

    def _failure_from_response(self, response: httpx.Response, default: str) -> YouCamFailure:
        return YouCamFailure(self._error_code(response, default), self._message(self._error_code(response, default)))

    def _error_code(self, response: httpx.Response, default: str) -> str:
        code = self._provider_error_code(response).lower()
        if "nsfw" in code or "safety" in code:
            return "provider_safety_rejection"
        if "ref" in code or "download" in code:
            return "invalid_product_image"
        if "src" in code or "pose" in code or "image" in code or "face" in code:
            return "invalid_user_image"
        return default

    @staticmethod
    def _provider_error_code(response: httpx.Response) -> str:
        try:
            payload = response.json()
        except ValueError:
            return ""
        if not isinstance(payload, dict):
            return ""
        data = payload.get("data")
        for container in (data, payload):
            if not isinstance(container, dict):
                continue
            error = container.get("error")
            if isinstance(error, dict) and isinstance(error.get("code"), str):
                return error["code"]
            if isinstance(error, str):
                return error
            if isinstance(container.get("error_code"), str):
                return container["error_code"]
        return ""

    @classmethod
    def _failed(cls, code: str) -> ProviderTaskState:
        return ProviderTaskState(status="failed", error_code=code, error_message=cls._message(code))

    @staticmethod
    def _message(code: str) -> str:
        return {
            "invalid_user_image": "YouCam could not use this user image.",
            "invalid_product_image": "YouCam could not use this product image.",
            "provider_safety_rejection": "YouCam rejected this request for safety reasons.",
        }.get(code, "YouCam could not complete this preview.")

    def __repr__(self) -> str:
        return f"YouCamClient(key_count={len(self._keys)})"
