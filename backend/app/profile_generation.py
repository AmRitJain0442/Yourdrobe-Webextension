import base64
import binascii
from collections.abc import Callable
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv


ENV_FILE = Path(__file__).resolve().parents[1] / ".env"
MAX_IMAGE_BYTES = 10 * 1024 * 1024
PROFILE_ROLES = ("face_front", "face_left", "face_right", "full_body_front", "full_body_side")
PROMPTS = {
    "face_front": "Create a front-facing head-and-shoulders studio identity photo of this exact person, looking straight at the camera.",
    "face_left": "Create a head-and-shoulders studio identity photo of this exact person with their face turned 90 degrees to their left.",
    "face_right": "Create a head-and-shoulders studio identity photo of this exact person with their face turned 90 degrees to their right.",
    "full_body_front": "Create a front-facing, head-to-toe studio identity photo of this exact person standing naturally with arms slightly away from the body and both feet visible.",
    "full_body_side": "Create a 90-degree side-view, head-to-toe studio identity photo of this exact person standing naturally with both feet visible.",
}
COMMON_PROMPT = (
    " Preserve the person's identity, facial features, skin tone, hair, clothing, body shape, and proportions; do not beautify or reshape them. "
    "Use even neutral studio lighting and a seamless pure white (#FFFFFF) background. Show one person only, with no props, text, or borders. Output one photorealistic image."
)


class ProfileGenerationFailure(Exception):
    pass


class NanoBananaClient:
    def __init__(self, client_factory: Callable[[], Any] | None, model: str = "gemini-3.1-flash-image") -> None:
        self._client_factory = client_factory
        self._model = model

    @classmethod
    def from_environment(cls) -> "NanoBananaClient":
        load_dotenv(ENV_FILE, override=False)
        credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "").strip()
        if not credentials_path or not Path(credentials_path).is_file():
            return cls(None, os.getenv("NANO_BANANA_MODEL", "gemini-3.1-flash-image"))

        def create_client():
            import google.auth
            from google import genai
            from google.genai import types

            credentials, detected_project = google.auth.default(
                scopes=("https://www.googleapis.com/auth/cloud-platform",),
            )
            project = os.getenv("GOOGLE_CLOUD_PROJECT", "").strip() or detected_project
            if not project:
                raise ProfileGenerationFailure("The Google Cloud project could not be determined.")
            return genai.Client(
                vertexai=True,
                credentials=credentials,
                project=project,
                location=os.getenv("GOOGLE_CLOUD_LOCATION", "global"),
                http_options=types.HttpOptions(api_version="v1"),
            )

        return cls(create_client, os.getenv("NANO_BANANA_MODEL", "gemini-3.1-flash-image"))

    @property
    def enabled(self) -> bool:
        return self._client_factory is not None

    def generate(self, source_data_url: str) -> list[dict[str, str]]:
        mime_type, source = self._decode_source(source_data_url)
        if not self._client_factory:
            raise ProfileGenerationFailure("Nano Banana profile generation is not configured.")
        try:
            from google.genai import types

            client = self._client_factory()
            config = types.GenerateContentConfig(
                response_modalities=["TEXT", "IMAGE"],
                image_config=types.ImageConfig(aspect_ratio="3:4", image_size="2K"),
            )
            assets = []
            for role in PROFILE_ROLES:
                response = client.models.generate_content(
                    model=self._model,
                    contents=[PROMPTS[role] + COMMON_PROMPT, types.Part.from_bytes(data=source, mime_type=mime_type)],
                    config=config,
                )
                generated_mime, generated = self._output_image(response)
                assets.append({
                    "kind": role,
                    "image_data_url": f"data:{generated_mime};base64,{base64.b64encode(generated).decode()}",
                })
            return assets
        except ProfileGenerationFailure:
            raise
        except Exception as error:
            status = getattr(error, "status_code", None) or getattr(error, "code", None)
            messages = {
                400: "Google could not use that source photo. Try a clear, well-lit full-body photo.",
                401: "Nano Banana authentication failed. Restart the backend after checking its Google credential.",
                403: "The Google account cannot use Nano Banana in the configured project.",
                404: "The configured Nano Banana model is unavailable in this project.",
                429: "Nano Banana quota is temporarily exhausted. Try again shortly.",
            }
            message = messages.get(status)
            if not message and isinstance(status, int) and status >= 500:
                message = "Nano Banana is temporarily unavailable. Try again shortly."
            raise ProfileGenerationFailure(message or "Nano Banana could not generate the profile photos.") from error

    @staticmethod
    def _decode_source(value: str) -> tuple[str, bytes]:
        try:
            prefix, encoded = value.split(",", 1)
            mime_type = prefix.removeprefix("data:").removesuffix(";base64")
            if prefix != f"data:{mime_type};base64" or mime_type not in ("image/jpeg", "image/png", "image/webp"):
                raise ValueError
            content = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise ProfileGenerationFailure("Use a valid JPEG, PNG, or WebP full-body photo.") from None
        if not content or len(content) >= MAX_IMAGE_BYTES:
            raise ProfileGenerationFailure("Choose a full-body photo smaller than 10 MB.")
        return mime_type, content

    @staticmethod
    def _output_image(response: Any) -> tuple[str, bytes]:
        for candidate in response.candidates or ():
            for part in candidate.content.parts or ():
                inline = getattr(part, "inline_data", None)
                if inline and inline.mime_type in ("image/jpeg", "image/png") and inline.data:
                    content = bytes(inline.data)
                    if len(content) >= MAX_IMAGE_BYTES:
                        raise ProfileGenerationFailure("Nano Banana returned an image that was too large.")
                    return inline.mime_type, content
        raise ProfileGenerationFailure("Nano Banana did not return a usable profile image.")
