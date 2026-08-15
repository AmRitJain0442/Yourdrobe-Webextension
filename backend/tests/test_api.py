import time
import unittest

from fastapi.testclient import TestClient

from app.main import app, jobs, products, profiles, sessions


class ApiJourneyTest(unittest.TestCase):
    def setUp(self) -> None:
        for collection in (sessions, profiles, products, jobs):
            collection.clear()
        self.client = TestClient(app)

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
                "image_data_url": "data:image/jpeg;base64,ZmFrZQ==",
                "consent": True,
            },
        )
        self.assertEqual(response.status_code, 404)

    def test_profile_storage_is_bounded(self) -> None:
        session_id = self.client.post("/v1/sessions", json={}).json()["session_id"]
        for _ in range(101):
            response = self.client.post(
                "/v1/profiles",
                json={
                    "session_id": session_id,
                    "image_data_url": "data:image/jpeg;base64,ZmFrZQ==",
                    "consent": True,
                },
            )
            self.assertEqual(response.status_code, 200)
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
        profile_id = self.client.post(
            "/v1/profiles",
            json={
                "session_id": session_id,
                "image_data_url": "data:image/jpeg;base64,ZmFrZQ==",
                "consent": True,
            },
        ).json()["profile_id"]
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
        profile_id = self.client.post(
            "/v1/profiles",
            json={
                "session_id": session_id,
                "image_data_url": "data:image/jpeg;base64,ZmFrZQ==",
                "consent": True,
            },
        ).json()["profile_id"]
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
        profile_response = self.client.post(
            "/v1/profiles",
            json={
                "session_id": session["session_id"],
                "image_data_url": "data:image/jpeg;base64,ZmFrZQ==",
                "consent": True,
            },
        )
        self.assertEqual(profile_response.status_code, 200)
        profile = profile_response.json()

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
                "image_data_url": "data:image/jpeg;base64,ZmFrZQ==",
                "consent": False,
            },
        )
        self.assertEqual(response.status_code, 400)

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
