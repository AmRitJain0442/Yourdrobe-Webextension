<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
  <img src="docs/assets/logo.svg" alt="Yourdrobe" width="420">
</picture>

### Try clothes on yourself while you shop, without leaving the store.

Yourdrobe is a Chrome side panel that reads product listings from Amazon, Flipkart, and Nykaa,
renders them onto a photo of you with the **Perfect Corp YouCam API**, and stacks each result
into one complete outfit that it can push straight to the retailer's cart.

<br>

[![Try-on engine](https://img.shields.io/badge/Try--on_engine-Perfect_Corp_YouCam-f43f7a?style=flat-square)](https://docs.perfectcorp.com/)
[![YouCam APIs](https://img.shields.io/badge/YouCam_APIs-Clothes_V3_·_Shoes_·_Hat-ff5d9a?style=flat-square)](https://docs.perfectcorp.com/reference/ai_clothes/section/overview)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest_V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white)](extension/public/manifest.json)

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](backend/requirements.txt)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.116-009688?style=flat-square&logo=fastapi&logoColor=white)](backend/app/main.py)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)](extension/package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?style=flat-square&logo=typescript&logoColor=white)](extension/tsconfig.json)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white)](extension/vite.config.ts)
[![Tests](https://img.shields.io/badge/Tests-Vitest_+_unittest-7c5cfa?style=flat-square&logo=vitest&logoColor=white)](#testing)

</div>

---

## Contents

- [What Yourdrobe does](#what-yourdrobe-does)
- [Inside the YouCam integration](#inside-the-youcam-integration)
- [System architecture](#system-architecture)
- [Workflows](#workflows)
  - [Try-on request lifecycle](#try-on-request-lifecycle)
  - [Outfit composition loop](#outfit-composition-loop)
  - [YouCam task routing](#youcam-task-routing)
  - [Finalize to cart](#finalize-to-cart)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running Yourdrobe](#running-yourdrobe)
- [Configuration reference](#configuration-reference)
- [API reference](#api-reference)
- [Support matrix](#support-matrix)
- [Privacy and data handling](#privacy-and-data-handling)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
