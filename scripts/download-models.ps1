# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Sitr contributors
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'models.mjs') --sources
if ($LASTEXITCODE -ne 0) { throw 'Model download or SHA-256 verification failed' }
