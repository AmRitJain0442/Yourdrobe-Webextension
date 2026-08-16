import base64
import unittest

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


class NanoBananaClientTest(unittest.TestCase):
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
