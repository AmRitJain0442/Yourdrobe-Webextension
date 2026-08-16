import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import httpx

from app import youcam
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

    def test_reads_exact_environment_key_variable_without_leaking_values(self) -> None:
        with patch.dict(os.environ, {"YOUCAM_API_KEYS": " first ,,second,first "}):
            client = YouCamClient.from_environment()
        self.assertTrue(client.enabled)
        self.assertEqual(client.key_count, 2)
        self.assertNotIn("first", repr(client))

    def test_reads_keys_from_backend_env_file(self) -> None:
        with TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text("YOUCAM_API_KEYS=file-one,file-two\n")
            with patch.dict(os.environ, {}, clear=True), patch.object(youcam, "ENV_FILE", env_file):
                self.assertEqual(YouCamClient.from_environment().key_count, 2)

    def test_process_keys_override_backend_env_file(self) -> None:
        with TemporaryDirectory() as directory:
            env_file = Path(directory) / ".env"
            env_file.write_text("YOUCAM_API_KEYS=file-one,file-two\n")
            with patch.dict(os.environ, {"YOUCAM_API_KEYS": "shell-only"}, clear=True), patch.object(youcam, "ENV_FILE", env_file):
                self.assertEqual(YouCamClient.from_environment().key_count, 1)

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

    def test_rotates_after_retryable_signed_upload_failure(self) -> None:
        self.responses = [
            httpx.Response(200, json={"data": {"files": [{"file_id": "source-file", "requests": [{
                "url": "https://uploads.example/source", "headers": {},
            }]}]}}),
            httpx.Response(503),
            httpx.Response(200, json={"data": {"files": [{"file_id": "source-file", "requests": [{
                "url": "https://uploads.example/source", "headers": {},
            }]}]}}),
            httpx.Response(200),
            httpx.Response(200, json={"data": {"task_id": "provider-task"}}),
        ]
        started = self.two_key_client.create_clothes_task(
            "data:image/jpeg;base64,cGhvdG8=", "https://images.example/top.jpg", "upper_body",
        )
        self.assertEqual(started.key_index, 1)
        self.assertEqual([request[0] for request in self.requests], ["POST", "PUT", "POST", "PUT", "POST"])

    def test_rotates_after_retryable_task_creation_failure(self) -> None:
        self.responses = [
            httpx.Response(200, json={"data": {"files": [{"file_id": "source-file", "requests": [{
                "url": "https://uploads.example/source", "headers": {},
            }]}]}}),
            httpx.Response(200),
            httpx.Response(503),
            httpx.Response(200, json={"data": {"files": [{"file_id": "source-file", "requests": [{
                "url": "https://uploads.example/source", "headers": {},
            }]}]}}),
            httpx.Response(200),
            httpx.Response(200, json={"data": {"task_id": "provider-task"}}),
        ]
        started = self.two_key_client.create_clothes_task(
            "data:image/jpeg;base64,cGhvdG8=", "https://images.example/top.jpg", "upper_body",
        )
        self.assertEqual(started.key_index, 1)
        self.assertEqual([self.requests[index][2]["authorization"] for index in (2, 5)], ["Bearer first", "Bearer second"])

    def test_does_not_rotate_after_invalid_image_response(self) -> None:
        self.responses = [httpx.Response(400, json={"error": {"code": "invalid_image"}})]
        with self.assertRaisesRegex(YouCamFailure, "user image"):
            self.two_key_client.create_clothes_task(
                "data:image/jpeg;base64,cGhvdG8=",
                "https://images.example/top.jpg",
                "upper_body",
            )
        self.assertEqual(self.authorization_headers, ["Bearer first"])

    def test_maps_root_validation_creation_error_without_key_rotation(self) -> None:
        self.responses = [
            httpx.Response(200, json={"data": {"files": [{"file_id": "source-file", "requests": [{
                "url": "https://uploads.example/source", "headers": {},
            }]}]}}),
            httpx.Response(200),
            httpx.Response(400, json={"error": {"code": "error_invalid_src"}}),
        ]
        with self.assertRaisesRegex(YouCamFailure, "user image") as raised:
            self.two_key_client.create_clothes_task(
                "data:image/jpeg;base64,cGhvdG8=", "https://images.example/top.jpg", "upper_body",
            )
        self.assertEqual(raised.exception.code, "invalid_user_image")
        self.assertEqual(len(self.requests), 3)
        self.assertEqual(self.requests[2][2]["authorization"], "Bearer first")

    def test_maps_root_safety_creation_error_without_key_rotation(self) -> None:
        self.responses = [
            httpx.Response(200, json={"data": {"files": [{"file_id": "source-file", "requests": [{
                "url": "https://uploads.example/source", "headers": {},
            }]}]}}),
            httpx.Response(200),
            httpx.Response(400, json={"error": {"code": "error_nsfw_content_detected"}}),
        ]
        with self.assertRaisesRegex(YouCamFailure, "safety reasons") as raised:
            self.two_key_client.create_clothes_task(
                "data:image/jpeg;base64,cGhvdG8=", "https://images.example/top.jpg", "upper_body",
            )
        self.assertEqual(raised.exception.code, "provider_safety_rejection")
        self.assertEqual(len(self.requests), 3)
        self.assertEqual(self.requests[2][2]["authorization"], "Bearer first")

    def test_maps_string_data_error_without_key_rotation(self) -> None:
        self.responses = [
            httpx.Response(200, json={"data": {"files": [{"file_id": "source-file", "requests": [{
                "url": "https://uploads.example/source", "headers": {},
            }]}]}}),
            httpx.Response(200),
            httpx.Response(400, json={"data": {"error": "error_invalid_src"}}),
        ]
        with self.assertRaises(YouCamFailure) as raised:
            self.two_key_client.create_clothes_task(
                "data:image/jpeg;base64,cGhvdG8=", "https://images.example/top.jpg", "upper_body",
            )
        self.assertEqual(raised.exception.code, "invalid_user_image")
        self.assertEqual(len(self.requests), 3)

    def test_maps_root_error_code_without_key_rotation(self) -> None:
        self.responses = [httpx.Response(400, json={"error_code": "error_nsfw_content_detected"})]
        with self.assertRaises(YouCamFailure) as raised:
            self.two_key_client.create_clothes_task(
                "data:image/jpeg;base64,cGhvdG8=", "https://images.example/top.jpg", "upper_body",
            )
        self.assertEqual(raised.exception.code, "provider_safety_rejection")
        self.assertEqual(len(self.requests), 1)

    def test_does_not_treat_status_600_as_retryable(self) -> None:
        self.responses = [httpx.Response(600)]
        with self.assertRaisesRegex(YouCamFailure, "could not create"):
            self.two_key_client.create_clothes_task(
                "data:image/jpeg;base64,cGhvdG8=", "https://images.example/top.jpg", "upper_body",
            )
        self.assertEqual(len(self.requests), 1)

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

    def test_rejects_empty_provider_task_id(self) -> None:
        self.responses[2] = httpx.Response(200, json={"data": {"task_id": "  "}})
        with self.assertRaises(YouCamFailure) as raised:
            self.client.create_clothes_task(
                "data:image/jpeg;base64,cGhvdG8=", "https://images.example/top.jpg", "upper_body",
            )
        self.assertEqual(raised.exception.code, "provider_processing_failed")

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

    def test_rejects_empty_or_non_https_success_result_url(self) -> None:
        for result_url in ("", "http://provider.example/result.jpg"):
            with self.subTest(result_url=result_url):
                self.responses = [httpx.Response(200, json={
                    "data": {"task_status": "success", "results": {"url": result_url}},
                })]
                self.assertEqual(self.client.get_task("provider-task", 0), ProviderTaskState(
                    status="failed",
                    error_code="provider_processing_failed",
                    error_message="YouCam could not complete this preview.",
                ))

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

    def test_downloads_allowed_result_image(self) -> None:
        self.responses = [httpx.Response(200, content=b"image", headers={"content-type": "image/jpeg"})]
        content, content_type = self.client.download_result(
            "https://yce-us.s3-accelerate.amazonaws.com/demo/ttl30/result.jpg"
        )
        self.assertEqual((content, content_type), (b"image", "image/jpeg"))

    def test_rejects_http_result_url(self) -> None:
        with self.assertRaises(YouCamFailure) as raised:
            self.client.download_result("http://yce-us.s3-accelerate.amazonaws.com/result.jpg")
        self.assertEqual(raised.exception.code, "provider_result_unavailable")
        self.assertEqual(self.requests, [])

    def test_rejects_unapproved_result_host(self) -> None:
        with self.assertRaises(YouCamFailure) as raised:
            self.client.download_result("https://yce-us.s3-accelerate.amazonaws.com.evil.example/result.jpg")
        self.assertEqual(raised.exception.code, "provider_result_unavailable")
        self.assertEqual(self.requests, [])

    def test_rejects_result_redirect_without_following_it(self) -> None:
        requests = []

        def redirect(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(302, headers={"location": "https://yce-eu.s3-accelerate.amazonaws.com/result.jpg"})

        client = YouCamClient.from_value(
            "first", httpx.Client(transport=httpx.MockTransport(redirect), follow_redirects=True),
        )
        with self.assertRaises(YouCamFailure) as raised:
            client.download_result("https://yce-us.s3-accelerate.amazonaws.com/result.jpg")
        self.assertEqual(raised.exception.code, "provider_result_unavailable")
        self.assertEqual(len(requests), 1)

    def test_rejects_non_200_result_response(self) -> None:
        self.responses = [httpx.Response(404)]
        with self.assertRaises(YouCamFailure) as raised:
            self.client.download_result("https://yce-us.s3-accelerate.amazonaws.com/result.jpg")
        self.assertEqual(raised.exception.code, "provider_result_unavailable")

    def test_rejects_non_image_result_content_type(self) -> None:
        self.responses = [httpx.Response(200, content=b"image", headers={"content-type": "text/html"})]
        with self.assertRaises(YouCamFailure) as raised:
            self.client.download_result("https://yce-us.s3-accelerate.amazonaws.com/result.jpg")
        self.assertEqual(raised.exception.code, "provider_result_unavailable")

    def test_rejects_result_at_image_size_limit(self) -> None:
        self.responses = [httpx.Response(
            200, content=b"x" * youcam.MAX_IMAGE_BYTES, headers={"content-type": "image/png"},
        )]
        with self.assertRaises(YouCamFailure) as raised:
            self.client.download_result("https://yce-us.s3-accelerate.amazonaws.com/result.png")
        self.assertEqual(raised.exception.code, "provider_result_unavailable")


if __name__ == "__main__":
    unittest.main()
