import base64
import os
import unittest
from unittest.mock import patch

from app.profile_generation import MAX_IMAGE_BYTES, NanoBananaClient, ProfileGenerationFailure, PROFILE_ROLES


class FakeInlineData:
    mime_type = "image/jpeg"
    data = b"generated"


class FakePart:
    inline_data = FakeInlineData()


class FakeContent:
    parts = [FakePart()]


class FakeCandidate:
    content = FakeContent()


class FakeResponse:
    candidates = [FakeCandidate()]


class FakeModels:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        return FakeResponse()


class FakeGenAI:
    def __init__(self) -> None:
        self.models = FakeModels()


class ProviderError(Exception):
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code


class FailingModels:
    def generate_content(self, **kwargs):
        raise ProviderError(429)


class FailingGenAI:
    models = FailingModels()


class NanoBananaClientTest(unittest.TestCase):
    def test_cloud_runtime_can_enable_application_default_credentials_without_a_key_file(self) -> None:
        environment = {
            "GOOGLE_GENAI_ENABLED": "true",
            "GOOGLE_CLOUD_PROJECT": "example-project",
        }

        with patch.dict(os.environ, environment, clear=True), patch("app.profile_generation.load_dotenv"):
            client = NanoBananaClient.from_environment()

        self.assertTrue(client.enabled)

    def test_local_runtime_stays_disabled_without_an_explicit_credential(self) -> None:
        with patch.dict(os.environ, {}, clear=True), patch("app.profile_generation.load_dotenv"):
            client = NanoBananaClient.from_environment()

        self.assertFalse(client.enabled)

    def test_reports_quota_failures_without_exposing_provider_details(self) -> None:
        source = "data:image/png;base64," + base64.b64encode(b"source").decode()

        with self.assertRaisesRegex(ProfileGenerationFailure, "quota is temporarily exhausted"):
            NanoBananaClient(lambda: FailingGenAI()).generate(source)

    def test_generates_every_required_role_with_white_background_prompts(self) -> None:
        provider = FakeGenAI()
        client = NanoBananaClient(lambda: provider)
        source = "data:image/png;base64," + base64.b64encode(b"source").decode()

        assets = client.generate(source)

        self.assertEqual([asset["kind"] for asset in assets], list(PROFILE_ROLES))
        self.assertEqual(len(provider.models.calls), 5)
        for call in provider.models.calls:
            self.assertIn("pure white", call["contents"][0])
            self.assertEqual(call["config"].image_config.aspect_ratio, "3:4")
            self.assertEqual(call["config"].image_config.image_size, "2K")
        self.assertTrue(all(asset["image_data_url"].startswith("data:image/jpeg;base64,") for asset in assets))

    def test_generates_a_composed_tryon_from_the_person_and_product_images(self) -> None:
        provider = FakeGenAI()
        client = NanoBananaClient(
            lambda: provider,
            reference_loader=lambda _url: ("image/png", b"product"),
        )
        source = "data:image/jpeg;base64," + base64.b64encode(b"person").decode()

        mime_type, image = client.generate_tryon(
            source, "https://images.example/bag.png", "Canvas shoulder bag", "bag",
        )

        self.assertEqual((mime_type, image), ("image/jpeg", b"generated"))
        call = provider.models.calls[0]
        self.assertIn("preserve", call["contents"][0])
        self.assertEqual(call["contents"][1].inline_data.data, b"person")
        self.assertEqual(call["contents"][2].inline_data.data, b"product")

    def test_rejects_invalid_or_oversized_source_images_before_provider_use(self) -> None:
        provider = FakeGenAI()
        client = NanoBananaClient(lambda: provider)
        sources = (
            "not-an-image",
            "data:image/gif;base64,R0lG",
            "data:image/png;base64,***",
            "data:image/png;base64," + base64.b64encode(b"x" * MAX_IMAGE_BYTES).decode(),
        )
        for index, source in enumerate(sources):
            with self.subTest(index=index), self.assertRaises(ProfileGenerationFailure):
                client.generate(source)
        self.assertEqual(provider.models.calls, [])


if __name__ == "__main__":
    unittest.main()
