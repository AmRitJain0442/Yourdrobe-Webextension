import time
import unittest

from fastapi.testclient import TestClient

import app.main as main
from app.main import app, jobs, products, profiles, sessions
from app.youcam import ProviderTaskState, StartedTask, YouCamFailure
from app.profile_generation import ProfileGenerationFailure


class DisabledYouCam:
    enabled = False


class FakeYouCam:
    def __init__(self) -> None:
        self.enabled = True
        self.created: list[tuple[str, str, str]] = []
        self.created_shoes: list[tuple[str, str, str]] = []
        self.created_hats: list[tuple[str, str, str]] = []
        self.polled: list[tuple[str, int, str]] = []
        self.failure: YouCamFailure | None = None
        self.download_failure: YouCamFailure | None = None

    def create_clothes_task(self, source: str, reference: str, category: str) -> StartedTask:
        self.created.append((source, reference, category))
        if self.failure:
            raise self.failure
        return StartedTask("provider-task", 1)

    def create_shoes_task(self, source: str, reference: str, gender: str) -> StartedTask:
        self.created_shoes.append((source, reference, gender))
        if self.failure:
            raise self.failure
        return StartedTask("provider-shoes-task", 1, "shoes")

    def create_hat_task(self, source: str, reference: str, gender: str) -> StartedTask:
        self.created_hats.append((source, reference, gender))
        if self.failure:
            raise self.failure
        return StartedTask("provider-hat-task", 1, "hat")

    def get_task(self, task_id: str, key_index: int, task_kind: str = "clothes") -> ProviderTaskState:
        self.polled.append((task_id, key_index, task_kind))
        return ProviderTaskState("completed", "https://provider.example/result.jpg")

    def download_result(self, url: str) -> tuple[bytes, str]:
        if self.download_failure:
            raise self.download_failure
        return b"rendered", "image/jpeg"


class FakeProfileGenerator:
    enabled = True
    tryon_enabled = False

    def __init__(self) -> None:
        self.sources: list[str] = []
        self.tryons: list[tuple[str, str, str, str]] = []
        self.failure: ProfileGenerationFailure | None = None

    def generate(self, source: str) -> list[dict[str, str]]:
        self.sources.append(source)
        if self.failure:
            raise self.failure
        return [
            {"kind": role, "image_data_url": f"data:image/jpeg;base64,{role}"}
            for role in ("face_front", "face_left", "face_right", "full_body_front", "full_body_side")
        ]

    def generate_tryon(self, source: str, reference: str, title: str, product_type: str) -> tuple[str, bytes]:
        self.tryons.append((source, reference, title, product_type))
        if self.failure:
            raise self.failure
        return "image/png", b"google-rendered"


class ApiJourneyTest(unittest.TestCase):
    def setUp(self) -> None:
        for collection in (sessions, profiles, products, jobs):
            collection.clear()
        self.saved_youcam = main.youcam
        self.saved_profile_generator = main.profile_generator
        main.youcam = DisabledYouCam()
        main.profile_generator = FakeProfileGenerator()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        main.youcam = self.saved_youcam
        main.profile_generator = self.saved_profile_generator

    def create_product(self, session_id: str, product_type: str = "top") -> str:
        return self.client.post(
            "/v1/products/normalize",
            json={
                "platform": "amazon_in",
                "products": [{
                    "platform": "amazon_in",
                    "title": f"Example {product_type}",
                    "product_type": product_type,
                    "image_url": f"https://images.example/{product_type}.jpg",
                    "product_url": f"https://amazon.in/dp/{product_type}",
                }],
            },
        ).json()["products"][0]["id"]

    def live_batch(self, product_id: str, cloud_consent: bool = True) -> dict:
        session_id = self.client.post("/v1/sessions", json={}).json()["session_id"]
        profile_id = self.create_profile(session_id, ("upper_body_front", "full_body_front"))
        return {
            "session_id": session_id,
            "profile_id": profile_id,
            "product_ids": [product_id],
            "assets": [
                {"kind": "upper_body_front", "image_data_url": "data:image/jpeg;base64,cGhvdG8="},
                {"kind": "full_body_front", "image_data_url": "data:image/jpeg;base64,cGhvdG8="},
            ],
            "cloud_consent": cloud_consent,
        }

    def makeup_batch(self) -> dict:
        session_id = self.client.post("/v1/sessions", json={}).json()["session_id"]
        profile_id = self.create_profile(session_id, ("full_body_front",))
        return {
            "session_id": session_id,
            "profile_id": profile_id,
            "product_ids": [self.create_product("unused", "makeup")],
            "assets": [{"kind": "full_body_front", "image_data_url": "data:image/jpeg;base64,cGhvdG8="}],
            "cloud_consent": True,
        }

    def test_capabilities_report_mock_when_provider_disabled(self) -> None:
        self.assertEqual(self.client.get("/v1/capabilities").json(), {
            "tryon_provider": "mock", "live_product_types": [],
            "youcam_product_types": [], "google_product_types": [],
        })

    def test_capabilities_report_live_clothing_types(self) -> None:
        main.youcam = FakeYouCam()
        self.assertEqual(self.client.get("/v1/capabilities").json(), {
            "tryon_provider": "youcam",
            "live_product_types": ["headwear", "top", "outerwear", "dress", "bottom", "footwear"],
            "youcam_product_types": ["headwear", "top", "outerwear", "bottom", "dress", "footwear"],
            "google_product_types": [],
        })

    def test_google_is_not_used_for_tryon(self) -> None:
        main.youcam = FakeYouCam()
        main.profile_generator.tryon_enabled = True
        session_id = self.client.post("/v1/sessions", json={}).json()["session_id"]
        profile_id = self.create_profile(session_id, ("full_body_front",))
        product_id = self.create_product("unused", "eyewear")
        response = self.client.post("/v1/tryons/batch", json={
            "session_id": session_id,
            "profile_id": profile_id,
            "product_ids": [product_id],
            "assets": [{"kind": "full_body_front", "image_data_url": "data:image/jpeg;base64,cGhvdG8="}],
            "cloud_consent": True,
        })
        self.assertEqual(response.json()["jobs"][0]["error_code"], "unsupported_live_category")
        self.assertEqual(main.profile_generator.tryons, [])

    def test_live_headwear_uses_hat_api_with_active_outfit(self) -> None:
        provider = FakeYouCam()
        main.youcam = provider
        product_id = self.create_product("unused", "headwear")
        products[product_id]["metadata"] = {"gender": "female"}
        body = self.live_batch(product_id)
        body["outfit_base_image_data_url"] = "data:image/jpeg;base64,b3V0Zml0"

        response = self.client.post("/v1/tryons/batch", json=body)
        self.assertEqual(response.status_code, 200)
        job_id = response.json()["jobs"][0]["job_id"]
        self.assertEqual(provider.created_hats, [(
            "data:image/jpeg;base64,b3V0Zml0", "https://images.example/headwear.jpg", "female",
        )])
        self.assertEqual(self.client.get(f"/v1/tryons/{job_id}").json()["status"], "completed")
        self.assertEqual(provider.polled[-1], ("provider-hat-task", 1, "hat"))

    def test_live_dress_creates_and_polls_provider_job(self) -> None:
        provider = FakeYouCam()
        main.youcam = provider
        product_id = self.create_product("unused", "dress")
        response = self.client.post("/v1/tryons/batch", json=self.live_batch(product_id))
        job_id = response.json()["jobs"][0]["job_id"]
        result = self.client.get(f"/v1/tryons/{job_id}").json()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["result_url"], "https://provider.example/result.jpg")
        self.assertFalse(result["mock"])
        self.assertEqual(provider.created[0][2], "full_body")
        self.assertEqual(provider.polled, [("provider-task", 1, "clothes")])
        self.assertNotIn("cGhvdG8", repr(jobs[job_id]))
        self.assertNotIn("Bearer", repr(jobs[job_id]))

    def test_completed_live_result_image_returns_provider_bytes(self) -> None:
        provider = FakeYouCam()
        main.youcam = provider
        product_id = self.create_product("unused", "dress")
        job_id = self.client.post(
            "/v1/tryons/batch", json=self.live_batch(product_id),
        ).json()["jobs"][0]["job_id"]
        completed = self.client.get(f"/v1/tryons/{job_id}").json()
        response = self.client.get(f"/v1/tryons/{job_id}/result-image")
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b"rendered")
        self.assertEqual(response.headers["content-type"], "image/jpeg")
        self.assertEqual(jobs[job_id]["result_url"], "https://provider.example/result.jpg")
        self.assertTrue(jobs[job_id]["completed"])

    def test_result_image_returns_404_for_unknown_job(self) -> None:
        self.assertEqual(self.client.get("/v1/tryons/missing/result-image").status_code, 404)

    def test_result_image_returns_409_for_queued_live_job(self) -> None:
        main.youcam = FakeYouCam()
        product_id = self.create_product("unused", "dress")
        job_id = self.client.post(
            "/v1/tryons/batch", json=self.live_batch(product_id),
        ).json()["jobs"][0]["job_id"]
        self.assertEqual(self.client.get(f"/v1/tryons/{job_id}/result-image").status_code, 409)

    def test_result_image_returns_409_for_failed_live_job(self) -> None:
        provider = FakeYouCam()
        provider.failure = YouCamFailure("provider_processing_failed", "YouCam could not create this preview.")
        main.youcam = provider
        product_id = self.create_product("unused", "dress")
        job_id = self.client.post(
            "/v1/tryons/batch", json=self.live_batch(product_id),
        ).json()["jobs"][0]["job_id"]
        self.assertEqual(self.client.get(f"/v1/tryons/{job_id}/result-image").status_code, 409)

    def test_result_image_returns_409_for_mock_job(self) -> None:
        product_id = self.create_product("unused", "dress")
        job_id = self.client.post(
            "/v1/tryons/batch", json=self.live_batch(product_id),
        ).json()["jobs"][0]["job_id"]
        self.assertEqual(self.client.get(f"/v1/tryons/{job_id}/result-image").status_code, 409)

    def test_result_image_maps_provider_download_failure_to_safe_502(self) -> None:
        provider = FakeYouCam()
        main.youcam = provider
        product_id = self.create_product("unused", "dress")
        job_id = self.client.post(
            "/v1/tryons/batch", json=self.live_batch(product_id),
        ).json()["jobs"][0]["job_id"]
        self.client.get(f"/v1/tryons/{job_id}")
        provider.download_failure = YouCamFailure(
            "provider_result_unavailable", "This YouCam result is no longer available.",
        )
        response = self.client.get(f"/v1/tryons/{job_id}/result-image")
        self.assertEqual(response.status_code, 502)
        self.assertEqual(response.json()["detail"], {
            "code": "provider_result_unavailable",
            "message": "This YouCam result is no longer available.",
        })

    def test_live_categories_map_to_provider_garments(self) -> None:
        provider = FakeYouCam()
        main.youcam = provider
        cases = {
            "top": ("upper_body", "data:image/jpeg;base64,ZnVsbA=="),
            "outerwear": ("upper_body", "data:image/jpeg;base64,ZnVsbA=="),
            "bottom": ("lower_body", "data:image/jpeg;base64,ZnVsbA=="),
            "dress": ("full_body", "data:image/jpeg;base64,ZnVsbA=="),
        }
        for product_type, (garment, source) in cases.items():
            product_id = self.create_product("unused", product_type)
            body = self.live_batch(product_id)
            body["assets"] = [
                {"kind": "upper_body_front", "image_data_url": "data:image/jpeg;base64,dXBwZXI="},
                {"kind": "full_body_front", "image_data_url": "data:image/jpeg;base64,ZnVsbA=="},
            ]
            response = self.client.post("/v1/tryons/batch", json=body)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(provider.created[-1][0], source)
            self.assertEqual(provider.created[-1][2], garment)

    def test_live_footwear_uses_shoes_api_with_active_outfit(self) -> None:
        provider = FakeYouCam()
        main.youcam = provider
        product_id = self.create_product("unused", "footwear")
        products[product_id]["metadata"] = {"gender": "female"}
        body = self.live_batch(product_id)
        body["outfit_base_image_data_url"] = "data:image/jpeg;base64,b3V0Zml0"

        response = self.client.post("/v1/tryons/batch", json=body)
        self.assertEqual(response.status_code, 200)
        job_id = response.json()["jobs"][0]["job_id"]
        self.assertEqual(provider.created_shoes, [(
            "data:image/jpeg;base64,b3V0Zml0", "https://images.example/footwear.jpg", "female",
        )])
        self.assertEqual(self.client.get(f"/v1/tryons/{job_id}").json()["status"], "completed")
        self.assertEqual(provider.polled[-1], ("provider-shoes-task", 1, "shoes"))

    def test_active_outfit_is_the_shared_source_for_a_mixed_live_batch(self) -> None:
        provider = FakeYouCam()
        main.youcam = provider
        top_id = self.create_product("unused", "top")
        bottom_id = self.create_product("unused", "bottom")
        body = self.live_batch(top_id)
        body["product_ids"] = [top_id, bottom_id]
        body["outfit_base_image_data_url"] = "data:image/jpeg;base64,b3V0Zml0"
        response = self.client.post("/v1/tryons/batch", json=body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual([call[0] for call in provider.created], [
            "data:image/jpeg;base64,b3V0Zml0",
            "data:image/jpeg;base64,b3V0Zml0",
        ])
        self.assertEqual([call[2] for call in provider.created], ["upper_body", "lower_body"])

    def test_active_outfit_satisfies_live_source_with_an_empty_profile(self) -> None:
        main.youcam = FakeYouCam()
        session_id = self.client.post("/v1/sessions", json={}).json()["session_id"]
        profile_id = self.create_profile(session_id, ())
        product_id = self.create_product("unused", "dress")
        response = self.client.post("/v1/tryons/batch", json={
            "session_id": session_id,
            "profile_id": profile_id,
            "product_ids": [product_id],
            "assets": [],
            "cloud_consent": True,
            "outfit_base_image_data_url": "data:image/png;base64,b3V0Zml0",
        })
        self.assertEqual(response.status_code, 200)

    def test_active_outfit_can_source_an_accessory_even_when_its_provider_is_unavailable(self) -> None:
        main.youcam = FakeYouCam()
        session_id = self.client.post("/v1/sessions", json={}).json()["session_id"]
        profile_id = self.create_profile(session_id, ())
        product_id = self.create_product("unused", "makeup")
        response = self.client.post("/v1/tryons/batch", json={
            "session_id": session_id,
            "profile_id": profile_id,
            "product_ids": [product_id],
            "cloud_consent": True,
            "outfit_base_image_data_url": "data:image/jpeg;base64,b3V0Zml0",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["jobs"][0]["error_code"], "unsupported_live_category")

    def test_live_batch_rejects_invalid_active_outfit_data(self) -> None:
        main.youcam = FakeYouCam()
        product_id = self.create_product("unused", "dress")
        oversized = "data:image/jpeg;base64,".ljust(14_000_001, "x")
        self.assertEqual(len(oversized), 14_000_001)
        for value in ("data:text/plain;base64,b3V0Zml0", oversized):
            body = self.live_batch(product_id)
            body["outfit_base_image_data_url"] = value
            with self.subTest(value=value[:30]):
                self.assertEqual(self.client.post("/v1/tryons/batch", json=body).status_code, 422)

    def test_live_batch_requires_cloud_consent(self) -> None:
        main.youcam = FakeYouCam()
        product_id = self.create_product("unused", "dress")
        response = self.client.post("/v1/tryons/batch", json=self.live_batch(product_id, cloud_consent=False))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["code"], "live_consent_required")

    def test_live_batch_rejects_coerced_cloud_consent(self) -> None:
        main.youcam = FakeYouCam()
        product_id = self.create_product("unused", "dress")
        body = self.live_batch(product_id)
        body["cloud_consent"] = "true"
        self.assertEqual(self.client.post("/v1/tryons/batch", json=body).status_code, 422)

    def test_live_batch_reports_missing_body_asset(self) -> None:
        main.youcam = FakeYouCam()
        product_id = self.create_product("unused", "dress")
        body = self.live_batch(product_id)
        body["assets"] = [{"kind": "upper_body_front", "image_data_url": "data:image/jpeg;base64,cGhvdG8="}]
        response = self.client.post("/v1/tryons/batch", json=body)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], {
            "code": "missing_profile_assets", "roles": ["full_body_front"],
        })

    def test_unsupported_live_category_is_failed_without_provider_call(self) -> None:
        provider = FakeYouCam()
        main.youcam = provider
        body = self.makeup_batch()
        body["cloud_consent"] = False
        job = self.client.post("/v1/tryons/batch", json=body).json()["jobs"][0]
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["error_code"], "unsupported_live_category")
        self.assertEqual(job["error_message"], "Live try-on is not available for this product type.")
        self.assertFalse(job["mock"])
        self.assertEqual(provider.created, [])

    def test_live_provider_failure_is_stored_without_mock(self) -> None:
        provider = FakeYouCam()
        provider.failure = YouCamFailure("youcam_rate_limited", "YouCam is rate limited. Please try again later.")
        main.youcam = provider
        product_id = self.create_product("unused", "top")
        response = self.client.post("/v1/tryons/batch", json=self.live_batch(product_id))
        immediate = response.json()["jobs"][0]
        self.assertEqual(immediate["error_message"], "YouCam is rate limited. Please try again later.")
        self.assertFalse(immediate["mock"])
        job_id = immediate["job_id"]
        result = self.client.get(f"/v1/tryons/{job_id}").json()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error_code"], "youcam_rate_limited")
        self.assertFalse(result["mock"])

    def test_live_batch_rejects_unbounded_asset_data(self) -> None:
        main.youcam = FakeYouCam()
        product_id = self.create_product("unused", "dress")
        body = self.live_batch(product_id)
        body["assets"][1]["image_data_url"] = "x" * 14_000_001
        self.assertEqual(self.client.post("/v1/tryons/batch", json=body).status_code, 422)

    def create_profile(self, session_id: str, roles: tuple[str, ...] = ("upper_body_front",)) -> str:
        response = self.client.post("/v1/profiles", json={
            "session_id": session_id,
            "consent": True,
            "assets": [
                {"kind": role, "image_data_url": "data:image/jpeg;base64,ZmFrZQ=="}
                for role in roles
            ],
            "attributes": {"height_cm": 170, "top_size": "M"},
        })
        self.assertEqual(response.status_code, 200)
        return response.json()["profile_id"]

    def test_arbitrary_origin_receives_no_cors_allow_origin_header(self) -> None:
        response = self.client.post(
            "/v1/sessions",
            headers={"Origin": "https://attacker.example"},
            json={},
        )
        self.assertNotIn("access-control-allow-origin", response.headers)

    def test_session_storage_evicts_the_oldest_entry_at_its_limit(self) -> None:
        created = [self.client.post("/v1/sessions", json={}).json()["session_id"] for _ in range(101)]
        self.assertEqual(len(sessions), 100)
        response = self.client.post(
            "/v1/profiles",
            json={
                "session_id": created[0],
                "assets": [{"kind": "upper_body_front", "image_data_url": "data:image/jpeg;base64,ZmFrZQ=="}],
                "consent": True,
            },
        )
        self.assertEqual(response.status_code, 404)

    def test_profile_storage_is_bounded(self) -> None:
        session_id = self.client.post("/v1/sessions", json={}).json()["session_id"]
        for _ in range(101):
            self.create_profile(session_id)
        self.assertEqual(len(profiles), 100)

    def test_product_storage_is_bounded(self) -> None:
        for index in range(101):
            response = self.client.post(
                "/v1/products/normalize",
                json={
                    "platform": "amazon_in",
                    "products": [{
                        "platform": "amazon_in",
                        "title": f"Shirt {index}",
                        "image_url": "https://images.example/shirt.jpg",
                        "product_url": f"https://amazon.in/dp/{index}",
                    }],
                },
            )
            self.assertEqual(response.status_code, 200)
        self.assertEqual(len(products), 100)

    def test_job_storage_is_bounded(self) -> None:
        session_id = self.client.post("/v1/sessions", json={}).json()["session_id"]
        profile_id = self.create_profile(session_id)
        product_id = self.client.post(
            "/v1/products/normalize",
            json={
                "platform": "amazon_in",
                "products": [{
                    "platform": "amazon_in",
                    "title": "Red Shirt",
                    "image_url": "https://images.example/shirt.jpg",
                    "product_url": "https://amazon.in/dp/B001",
                }],
            },
        ).json()["products"][0]["id"]
        for _ in range(101):
            response = self.client.post(
                "/v1/tryons/batch",
                json={
                    "session_id": session_id,
                    "profile_id": profile_id,
                    "product_ids": [product_id],
                },
            )
            self.assertEqual(response.status_code, 200)
        self.assertEqual(len(jobs), 100)

    def test_job_completion_survives_product_eviction(self) -> None:
        session_id = self.client.post("/v1/sessions", json={}).json()["session_id"]
        profile_id = self.create_profile(session_id)
        first_product = self.client.post(
            "/v1/products/normalize",
            json={
                "platform": "amazon_in",
                "products": [{
                    "platform": "amazon_in",
                    "title": "Original Shirt",
                    "image_url": "https://images.example/original.jpg",
                    "product_url": "https://amazon.in/dp/ORIGINAL",
                }],
            },
        ).json()["products"][0]
        job_id = self.client.post(
            "/v1/tryons/batch",
            json={
                "session_id": session_id,
                "profile_id": profile_id,
                "product_ids": [first_product["id"]],
            },
        ).json()["jobs"][0]["job_id"]
        for index in range(100):
            self.client.post(
                "/v1/products/normalize",
                json={
                    "platform": "amazon_in",
                    "products": [{
                        "platform": "amazon_in",
                        "title": f"Later Shirt {index}",
                        "image_url": "https://images.example/later.jpg",
                        "product_url": f"https://amazon.in/dp/LATER-{index}",
                    }],
                },
            )
        time.sleep(0.3)
        response = TestClient(app, raise_server_exceptions=False).get(f"/v1/tryons/{job_id}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["result_url"], "https://images.example/original.jpg")

    def test_mock_tryon_journey(self) -> None:
        self.assertEqual(self.client.get("/health").json(), {"status": "ok"})

        session = self.client.post("/v1/sessions", json={}).json()
        profile = {"profile_id": self.create_profile(session["session_id"])}

        normalized = self.client.post(
            "/v1/products/normalize",
            json={
                "platform": "amazon_in",
                "products": [{
                    "platform": "amazon_in",
                    "title": "Red Shirt",
                    "price": 1799,
                    "currency": "INR",
                    "category": "apparel",
                    "image_url": "https://images.example/shirt.jpg",
                    "product_url": "https://www.amazon.in/dp/B001",
                    "metadata": {"color": "red"},
                }],
            },
        ).json()

        jobs = self.client.post(
            "/v1/tryons/batch",
            json={
                "session_id": session["session_id"],
                "profile_id": profile["profile_id"],
                "product_ids": [normalized["products"][0]["id"]],
            },
        ).json()["jobs"]

        processing = self.client.get(f"/v1/tryons/{jobs[0]['job_id']}").json()
        self.assertEqual(processing.get("product_id"), normalized["products"][0]["id"])
        self.assertEqual(processing["progress"], 50)

        time.sleep(0.3)
        result = self.client.get(f"/v1/tryons/{jobs[0]['job_id']}").json()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["result_url"], "https://images.example/shirt.jpg")
        self.assertTrue(result["mock"])

    def test_profile_requires_consent(self) -> None:
        session = self.client.post("/v1/sessions", json={}).json()
        response = self.client.post(
            "/v1/profiles",
            json={
                "session_id": session["session_id"],
                "assets": [{"kind": "upper_body_front", "image_data_url": "data:image/jpeg;base64,ZmFrZQ=="}],
                "consent": False,
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_profile_retains_only_asset_roles(self) -> None:
        session_id = self.client.post("/v1/sessions", json={}).json()["session_id"]
        profile_id = self.create_profile(session_id, ("face_front", "right_hand_wrist"))
        self.assertEqual(profiles[profile_id], {"face_front", "right_hand_wrist"})
        self.assertNotIn("ZmFrZQ", repr(profiles))
        self.assertNotIn("height_cm", repr(profiles))

    def test_profile_rejects_duplicate_or_unsupported_roles(self) -> None:
        session_id = self.client.post("/v1/sessions", json={}).json()["session_id"]
        duplicate = self.client.post("/v1/profiles", json={
            "session_id": session_id, "consent": True,
            "assets": [
                {"kind": "face_front", "image_data_url": "data:image/jpeg;base64,QQ=="},
                {"kind": "face_front", "image_data_url": "data:image/jpeg;base64,Qg=="},
            ],
            "attributes": {},
        })
        unsupported = self.client.post("/v1/profiles", json={
            "session_id": session_id, "consent": True,
            "assets": [{"kind": "passport", "image_data_url": "data:image/jpeg;base64,QQ=="}],
            "attributes": {},
        })
        self.assertEqual(duplicate.status_code, 400)
        self.assertEqual(unsupported.status_code, 422)

    def test_tryon_reports_missing_profile_roles(self) -> None:
        session_id = self.client.post("/v1/sessions", json={}).json()["session_id"]
        profile_id = self.create_profile(session_id, ("face_front",))
        product_id = self.client.post("/v1/products/normalize", json={
            "platform": "amazon_in",
            "products": [{
                "platform": "amazon_in", "title": "Linen Dress", "category": "apparel",
                "product_type": "dress", "image_url": "https://images.example/dress.jpg",
                "product_url": "https://amazon.in/dp/DRESS",
            }],
        }).json()["products"][0]["id"]
        response = self.client.post("/v1/tryons/batch", json={
            "session_id": session_id, "profile_id": profile_id, "product_ids": [product_id],
        })
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["detail"], {
            "code": "missing_profile_assets", "roles": ["full_body_front"],
        })

    def test_front_full_body_photo_satisfies_non_face_product_requirements(self) -> None:
        session_id = self.client.post("/v1/sessions", json={}).json()["session_id"]
        profile_id = self.create_profile(session_id, ("full_body_front",))
        product_ids = [self.create_product("unused", product_type) for product_type in (
            "necklace", "watch", "bracelet", "ring", "footwear",
        )]

        response = self.client.post("/v1/tryons/batch", json={
            "session_id": session_id,
            "profile_id": profile_id,
            "product_ids": product_ids,
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()["jobs"]), 5)

    def test_normalize_rejects_unsupported_platform_or_host(self) -> None:
        response = self.client.post(
            "/v1/products/normalize",
            json={
                "platform": "unsupported",
                "products": [{
                    "platform": "unsupported",
                    "title": "Red Shirt",
                    "image_url": "https://evil.example/shirt.jpg",
                    "product_url": "https://evil.example/shirt",
                }],
            },
        )
        self.assertEqual(response.status_code, 400)

    def test_normalize_rejects_malformed_product_url(self) -> None:
        response = TestClient(app, raise_server_exceptions=False).post(
            "/v1/products/normalize",
            json={
                "platform": "amazon_in",
                "products": [{
                    "platform": "amazon_in",
                    "title": "Bad Shirt",
                    "image_url": "https://images.example/shirt.jpg",
                    "product_url": "https://[",
                }],
            },
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json(), {"detail": "Unsupported product host"})

    def test_normalize_preserves_optional_brand(self) -> None:
        response = self.client.post(
            "/v1/products/normalize",
            json={
                "platform": "amazon_us",
                "products": [{
                    "platform": "amazon_us",
                    "title": "Blue Shirt",
                    "brand": "Example Brand",
                    "image_url": "https://images.example/shirt.jpg",
                    "product_url": "https://amazon.com/dp/B001",
                }],
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["products"][0].get("brand"), "Example Brand")

    def test_generates_the_five_profile_views_from_one_full_body_photo(self) -> None:
        source = "data:image/jpeg;base64,cGhvdG8="
        response = self.client.post("/v1/profiles/generate-assets", json={
            "image_data_url": source,
            "cloud_consent": True,
        })

        self.assertEqual(response.status_code, 200)
        self.assertEqual([asset["kind"] for asset in response.json()["assets"]], [
            "face_front", "face_left", "face_right", "full_body_front", "full_body_side",
        ])
        self.assertEqual(main.profile_generator.sources, [source])

    def test_profile_generation_requires_cloud_consent(self) -> None:
        response = self.client.post("/v1/profiles/generate-assets", json={
            "image_data_url": "data:image/jpeg;base64,cGhvdG8=",
            "cloud_consent": False,
        })

        self.assertEqual(response.status_code, 400)
        self.assertEqual(main.profile_generator.sources, [])


if __name__ == "__main__":
    unittest.main()
