# fetch-vendor.ps1
# 在仓库根目录运行此脚本以下载 Readability 与 Turndown 的浏览器构建到 public/vendor
# PowerShell 5.1 (Windows) 示例：
# Open PowerShell in repo root and run: .\scripts\fetch-vendor.ps1

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$vendorDir = Join-Path $repoRoot 'public\vendor'

if(-not (Test-Path $vendorDir)){
    New-Item -ItemType Directory -Path $vendorDir -Force | Out-Null
}

$readabilityUrl = 'https://cdn.jsdelivr.net/npm/@mozilla/readability@0.4.4/Readability.js'
$turndownUrl = 'https://cdn.jsdelivr.net/npm/turndown@7.1.1/dist/turndown.min.js'
$readabilityOut = Join-Path $vendorDir 'readability.js'
$turndownOut = Join-Path $vendorDir 'turndown.min.js'

Write-Host "Downloading Readability -> $readabilityOut"
Invoke-WebRequest -Uri $readabilityUrl -OutFile $readabilityOut -UseBasicParsing

Write-Host "Downloading Turndown -> $turndownOut"
Invoke-WebRequest -Uri $turndownUrl -OutFile $turndownOut -UseBasicParsing

Write-Host "Download complete. Files saved to: $vendorDir"
Write-Host "You can now open the target site and use the bookmarklet or console script; the script will try to load the same-origin vendor files when CDN is blocked by CSP."