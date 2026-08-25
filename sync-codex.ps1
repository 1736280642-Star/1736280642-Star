[CmdletBinding()]
param(
    [string]$CcusageVersion = "20.0.20",
    [switch]$ShowTokenCounts,
    [switch]$GenerateOnly
)

$ErrorActionPreference = "Stop"

$repoRoot = $PSScriptRoot
$jsonPath = Join-Path $repoRoot "codex.json"
$generatorPath = Join-Path $repoRoot "codex-heatmap.cjs"
$svgPath = Join-Path $repoRoot "codex-heatmap.svg"

Set-Location -LiteralPath $repoRoot

$npxCommand = Get-Command "npx.cmd" -ErrorAction SilentlyContinue
$nodeCommand = Get-Command "node.exe" -ErrorAction SilentlyContinue
$gitCommand = Get-Command "git.exe" -ErrorAction SilentlyContinue

if (-not $npxCommand -or -not $nodeCommand) {
    throw "Node.js was not found. Install Node.js LTS, reopen PowerShell, and run this script again."
}

if (-not $gitCommand) {
    throw "Git was not found. Install Git for Windows, reopen PowerShell, and run this script again."
}

Write-Host "Reading local Codex activity with ccusage $CcusageVersion..."

$rawLines = & $npxCommand.Source --yes "ccusage@$CcusageVersion" codex daily --json

if ($LASTEXITCODE -ne 0) {
    throw "ccusage failed. Confirm that Codex has local session logs under CODEX_HOME, then run the command manually for details."
}

$jsonText = ($rawLines -join [Environment]::NewLine).Trim()

if ([string]::IsNullOrWhiteSpace($jsonText)) {
    throw "ccusage returned no JSON. Use Codex locally at least once, then try again."
}

try {
    $null = $jsonText | ConvertFrom-Json
} catch {
    throw "ccusage returned invalid JSON. Run 'npx.cmd --yes ccusage@$CcusageVersion codex daily --json' manually and inspect non-sensitive error output."
}

[System.IO.File]::WriteAllText(
    $jsonPath,
    $jsonText,
    [System.Text.UTF8Encoding]::new($false)
)

$generatorArguments = @(
    $generatorPath,
    "--input", $jsonPath,
    "--output", $svgPath
)

if ($ShowTokenCounts) {
    $generatorArguments += "--show-token-counts"
}

& $nodeCommand.Source @generatorArguments

if ($LASTEXITCODE -ne 0) {
    throw "Heatmap generation failed. Check that codex.json matches the ccusage daily JSON structure."
}

if ($GenerateOnly) {
    Write-Host "Codex heatmap generated locally. Git commit and push were skipped."
    exit 0
}

& $gitCommand.Source -C $repoRoot rev-parse --is-inside-work-tree 1>$null 2>$null

if ($LASTEXITCODE -ne 0) {
    throw "The SVG was generated, but this folder is not a Git repository. Complete the repository setup in SETUP.md, then run again."
}

& $gitCommand.Source -C $repoRoot add -- "codex-heatmap.svg"

if ($LASTEXITCODE -ne 0) {
    throw "Git could not stage codex-heatmap.svg. Check the repository permissions and status."
}

& $gitCommand.Source -C $repoRoot diff --cached --quiet -- "codex-heatmap.svg"
$diffExitCode = $LASTEXITCODE

if ($diffExitCode -eq 0) {
    Write-Host "Heatmap is already up to date; no commit was created."
    exit 0
}

if ($diffExitCode -ne 1) {
    throw "Git could not compare the generated heatmap. Run 'git status' for details."
}

& $gitCommand.Source -C $repoRoot commit -m "chore: update Codex activity"

if ($LASTEXITCODE -ne 0) {
    throw "Git commit failed. Configure git user.name and user.email, then run again."
}

& $gitCommand.Source -C $repoRoot push

if ($LASTEXITCODE -ne 0) {
    throw "Git push failed. Confirm that origin and the upstream branch are configured and that GitHub authentication is valid."
}

Write-Host "Codex heatmap generated and synchronized to GitHub."
