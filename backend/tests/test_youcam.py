import json
import unittest

import httpx

from app.youcam import ProviderTaskState, StartedTask, YouCamClient, YouCamFailure


class YouCamClientTest(unittest.TestCase):
    def setUp(self) -> None:
        self.requests: list[tuple[str, str, dict[str, str], object | None]] = []
        self.authorization_headers: list[str] = []
        self.responses: list[httpx.Response | Exception] = [
            httpx.Response(200, json={
                "data": {"files": [{"file_id": "source-file", "requests": [{
                    "url": "https://uploads.example/source", "headers": {"x-upload": "signed"},
                }]}]},
            }),
            httpx.Response(200),
            httpx.Response(200, json={"data": {"task_id": "provider-task"}}),
        ]
        self.http = httpx.Client(transport=httpx.MockTransport(self.handler))
        self.client = YouCamClient.from_value("first", self.http)
        self.two_key_client = YouCamClient.from_value("first,second", self.http)

    def handler(self, request: httpx.Request) -> httpx.Response:
        try:
            body = json.loads(request.content) if request.content else None
        except json.JSONDecodeError:
            body = None
        headers = dict(request.headers)
        self.requests.append((request.method, request.url.path, headers, body))
        if (authorization := request.headers.get("authorization")) and (
            request.url.path.endswith("/file/cloth-v3") or request.method == "GET"
        ):
            self.authorization_headers.append(authorization)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def test_parses_trimmed_unique_keys(self) -> None:
        client = YouCamClient.from_value(" first ,,second,first ", self.http)
        self.assertEqual(client.key_count, 2)
        self.assertNotIn("first", repr(client))

    def test_uploads_image_and_creates_clothes_v3_task(self) -> None:
        started = self.client.create_clothes_task(
            "data:image/jpeg;base64,cGhvdG8=",
            "https://images.example/dress.jpg",
            "full_body",
        )
        self.assertEqual(started, StartedTask(task_id="provider-task", key_index=0))
        self.assertEqual(self.requests[0][0:2], ("POST", "/s2s/v2.0/file/cloth-v3"))
        self.assertEqual(self.requests[1][0], "PUT")
        self.assertEqual(self.requests[2][0:2], ("POST", "/s2s/v2.0/task/cloth-v3"))
        self.assertEqual(self.requests[2][3], {
            "src_file_id": "source-file",
            "ref_file_url": "https://images.example/dress.jpg",
            "garment_category": "full_body",
        })

    def test_rotates_after_retryable_creation_failure(self) -> None:
        self.responses = [
            httpx.Response(401),
            httpx.Response(200, json={
                "data": {"files": [{"file_id": "source-file", "requests": [{
                    "url": "https://uploads.example/source", "headers": {},
                }]}]},
            }),
            httpx.Response(200),
            httpx.Response(200, json={"data": {"task_id": "provider-task"}}),
        ]
        started = self.two_key_client.create_clothes_task(
            "data:image/png;base64,cGhvdG8=",
            "https://images.example/top.png",
            "upper_body",
        )
        self.assertEqual(started.key_index, 1)
        self.assertEqual(self.authorization_headers, ["Bearer first", "Bearer second"])

    def test_does_not_rotate_after_invalid_image_response(self) -> None:
        self.responses = [httpx.Response(400, json={"error": {"code": "invalid_image"}})]
        with self.assertRaisesRegex(YouCamFailure, "user image"):
            self.two_key_client.create_clothes_task(
                "data:image/jpeg;base64,cGhvdG8=",
                "https://images.example/top.jpg",
                "upper_body",
            )
        self.assertEqual(self.authorization_headers, ["Bearer first"])

    def test_rejects_invalid_data_url(self) -> None:
        with self.assertRaisesRegex(YouCamFailure, "user image") as raised:
            self.client.create_clothes_task("not-a-data-url", "https://images.example/top.jpg", "upper_body")
        self.assertEqual(raised.exception.code, "invalid_user_image")
        self.assertEqual(self.requests, [])

    def test_rejects_webp_at_backend_boundary(self) -> None:
        with self.assertRaisesRegex(YouCamFailure, "user image"):
            self.client.create_clothes_task("data:image/webp;base64,cGhvdG8=", "https://images.example/top.jpg", "upper_body")
        self.assertEqual(self.requests, [])

    def test_rejects_non_https_reference_url(self) -> None:
        with self.assertRaisesRegex(YouCamFailure, "product image") as raised:
            self.client.create_clothes_task("data:image/jpeg;base64,cGhvdG8=", "http://images.example/top.jpg", "upper_body")
        self.assertEqual(raised.exception.code, "invalid_product_image")
        self.assertEqual(self.requests, [])

    def test_reports_all_keys_exhausted(self) -> None:
        self.responses = [httpx.ConnectError("offline"), httpx.ReadTimeout("slow")]
        with self.assertRaisesRegex(YouCamFailure, "unavailable") as raised:
            self.two_key_client.create_clothes_task("data:image/jpeg;base64,cGhvdG8=", "https://images.example/top.jpg", "upper_body")
        self.assertEqual(raised.exception.code, "youcam_keys_exhausted")
        self.assertEqual(self.authorization_headers, ["Bearer first", "Bearer second"])

    def test_reports_all_keys_rate_limited(self) -> None:
        self.responses = [httpx.Response(429), httpx.Response(429)]
        with self.assertRaisesRegex(YouCamFailure, "rate limited") as raised:
            self.two_key_client.create_clothes_task("data:image/jpeg;base64,cGhvdG8=", "https://images.example/top.jpg", "upper_body")
        self.assertEqual(raised.exception.code, "youcam_rate_limited")

    def test_polls_with_creating_key_and_maps_success(self) -> None:
        self.responses = [httpx.Response(200, json={
            "data": {"task_status": "success", "results": {"url": "https://provider.example/result.jpg"}},
        })]
        state = self.two_key_client.get_task("provider-task", 1)
        self.assertEqual(state, ProviderTaskState(
            status="completed",
            result_url="https://provider.example/result.jpg",
        ))
        self.assertEqual(self.authorization_headers, ["Bearer second"])

    def test_maps_non_terminal_poll_to_processing(self) -> None:
        self.responses = [httpx.Response(200, json={"data": {"task_status": "processing"}})]
        self.assertEqual(self.client.get_task("provider-task", 0), ProviderTaskState(status="processing"))

    def test_maps_provider_terminal_error(self) -> None:
        self.responses = [httpx.Response(200, json={"data": {"task_status": "error", "error": {"code": "error_invalid_ref"}}})]
        self.assertEqual(self.client.get_task("provider-task", 0), ProviderTaskState(
            status="failed", error_code="invalid_product_image", error_message="YouCam could not use this product image.",
        ))

    def test_maps_provider_safety_error(self) -> None:
        self.responses = [httpx.Response(200, json={"data": {"task_status": "error", "error": {"code": "error_nsfw_content_detected"}}})]
        self.assertEqual(self.client.get_task("provider-task", 0), ProviderTaskState(
            status="failed", error_code="provider_safety_rejection", error_message="YouCam rejected this request for safety reasons.",
        ))

    def test_returns_processing_after_transient_poll_transport_failure(self) -> None:
        self.responses = [httpx.ConnectError("offline")]
        self.assertEqual(self.client.get_task("provider-task", 0), ProviderTaskState(status="processing"))


if __name__ == "__main__":
    unittest.main()
