import time
import unittest

from fastapi.testclient import TestClient

import app.main as main
from app.main import app, jobs, products, profiles, sessions
from app.youcam import ProviderTaskState, StartedTask, YouCamFailure


class DisabledYouCam:
    enabled = False


class FakeYouCam:
    def __init__(self) -> None:
        self.enabled = True
        self.created: list[tuple[str, str, str]] = []
        self.polled: list[tuple[str, int]] = []
        self.failure: YouCamFailure | None = None

    def create_clothes_task(self, source: str, reference: str, category: str) -> StartedTask:
        self.created.append((source, reference, category))
        if self.failure:
            raise self.failure
        return StartedTask("provider-task", 1)

    def get_task(self, task_id: str, key_index: int) -> ProviderTaskState:
        self.polled.append((task_id, key_index))
        return ProviderTaskState("completed", "https://provider.example/result.jpg")


class ApiJourneyTest(unittest.TestCase):
    def setUp(self) -> None:
        for collection in (sessions, profiles, products, jobs):
            collection.clear()
        self.saved_youcam = main.youcam
        main.youcam = DisabledYouCam()
        self.client = TestClient(app)

    def tearDown(self) -> None:
        main.youcam = self.saved_youcam

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
        profile_id = self.create_profile(session_id, ("face_front",))
        return {
            "session_id": session_id,
            "profile_id": profile_id,
            "product_ids": [self.create_product("unused", "makeup")],
            "assets": [{"kind": "face_front", "image_data_url": "data:image/jpeg;base64,cGhvdG8="}],
            "cloud_consent": True,
        }

    def test_capabilities_report_mock_when_provider_disabled(self) -> None:
        self.assertEqual(self.client.get("/v1/capabilities").json(), {
            "tryon_provider": "mock", "live_product_types": [],
        })

    def test_capabilities_report_live_clothing_types(self) -> None:
        main.youcam = FakeYouCam()
        self.assertEqual(self.client.get("/v1/capabilities").json(), {
            "tryon_provider": "youcam",
            "live_product_types": ["top", "outerwear", "bottom", "dress"],
        })

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
        self.assertEqual(provider.polled, [("provider-task", 1)])
        self.assertNotIn("cGhvdG8", repr(jobs[job_id]))
        self.assertNotIn("Bearer", repr(jobs[job_id]))

    def test_live_categories_map_to_provider_garments(self) -> None:
        provider = FakeYouCam()
        main.youcam = provider
        for product_type, garment in (("top", "upper_body"), ("outerwear", "upper_body"), ("bottom", "lower_body")):
            product_id = self.create_product("unused", product_type)
            response = self.client.post("/v1/tryons/batch", json=self.live_batch(product_id))
            self.assertEqual(response.status_code, 200)
            self.assertEqual(provider.created[-1][2], garment)

    def test_live_batch_requires_cloud_consent(self) -> None:
        main.youcam = FakeYouCam()
        product_id = self.create_product("unused", "dress")
        response = self.client.post("/v1/tryons/batch", json=self.live_batch(product_id, cloud_consent=False))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"]["code"], "live_consent_required")

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
        job = self.client.post("/v1/tryons/batch", json=self.makeup_batch()).json()["jobs"][0]
        self.assertEqual(job["status"], "failed")
        self.assertEqual(job["error_code"], "unsupported_live_category")
        self.assertEqual(provider.created, [])

    def test_live_provider_failure_is_stored_without_mock(self) -> None:
        provider = FakeYouCam()
        provider.failure = YouCamFailure("youcam_rate_limited", "YouCam is rate limited. Please try again later.")
        main.youcam = provider
        product_id = self.create_product("unused", "top")
        response = self.client.post("/v1/tryons/batch", json=self.live_batch(product_id))
        job_id = response.json()["jobs"][0]["job_id"]
        result = self.client.get(f"/v1/tryons/{job_id}").json()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error_code"], "youcam_rate_limited")
        self.assertFalse(result["mock"])

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


if __name__ == "__main__":
    unittest.main()
