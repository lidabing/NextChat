# inline-vendor.ps1
# 在仓库根目录运行：
# .\scripts\inline-vendor.ps1
# 功能：下载 Readability 与 Turndown 到 public/vendor（如果缺失），并生成一个自包含的
# public/extract-markdown-bundled.js，将两个库代码和现有的 extract 脚本拼接为一个文件，便于作为 bookmarklet 或在受限环境下直接使用。

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$publicDir = Join-Path $repoRoot 'public'
$vendorDir = Join-Path $publicDir 'vendor'
if(-not (Test-Path $vendorDir)) { New-Item -ItemType Directory -Path $vendorDir | Out-Null }

$readabilityUrl = 'https://cdn.jsdelivr.net/npm/@mozilla/readability@0.4.4/Readability.js'
$turndownUrl = 'https://cdn.jsdelivr.net/npm/turndown@7.1.1/dist/turndown.min.js'
$readabilityOut = Join-Path $vendorDir 'readability.js'
$turndownOut = Join-Path $vendorDir 'turndown.min.js'

function Download-IfMissing([string]$url, [string]$outPath) {
    if(Test-Path $outPath) { Write-Host "Already have: $outPath"; return }
    Write-Host "Downloading $url -> $outPath"
    Invoke-WebRequest -Uri $url -OutFile $outPath -UseBasicParsing
}

Download-IfMissing $readabilityUrl $readabilityOut
Download-IfMissing $turndownUrl $turndownOut

# Read files
$readabilityCode = Get-Content -Raw -Encoding UTF8 $readabilityOut
$turndownCode = Get-Content -Raw -Encoding UTF8 $turndownOut
$extractPath = Join-Path $publicDir 'extract-markdown.js'
if(-not (Test-Path $extractPath)) { throw "Missing $extractPath" }
$extractCode = Get-Content -Raw -Encoding UTF8 $extractPath

$bundlePath = Join-Path $publicDir 'extract-markdown-bundled.js'

$header = "/* Bundled extract-markdown — Readability + Turndown + extractor */`n"
$sep = "\n/* ----- LIB SEPARATOR ----- */\n"

$bundleContent = $header + "/* Readability (bundled) */\n" + $readabilityCode + $sep + "/* Turndown (bundled) */\n" + $turndownCode + $sep + "/* Extractor script (bundled) */\n" + $extractCode

Set-Content -Path $bundlePath -Value $bundleContent -Encoding UTF8
Write-Host "Bundled file written to: $bundlePath"
Write-Host "You can now use /extract-markdown-bundled.js as a single self-contained script."