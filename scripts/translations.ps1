<#
.SYNOPSIS
    Updates and compiles the backend translations (French, Arabic).

.DESCRIPTION
    1. makemessages: collects every message marked with gettext / _() in the code into
       backend\locale\<language>\LC_MESSAGES\django.po (new messages arrive untranslated).
    2. compilemessages: turns the .po files into the .mo files Django reads.
    Workflow: mark the message in the code, run this script, translate the new entries
    in the .po files (msgstr), run it again with -CompileOnly. The test
    TranslationCatalogTests fails while a message is untranslated or not compiled.
    Needs GNU gettext: winget install --id mlocati.GetText --exact

.PARAMETER CompileOnly
    Only compile the .po files (after translating them).

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\translations.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File scripts\translations.ps1 -CompileOnly
#>
param([switch]$CompileOnly)

$ErrorActionPreference = "Continue"
$env:PYTHONUTF8 = "1"
$languages = @("fr", "ar")  # English is the language of the code: nothing to translate

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$python = Join-Path $backend ".venv\Scripts\python.exe"

# Terminals opened before gettext was installed do not have it in PATH yet: look for it.
if (-not (Get-Command msgfmt -ErrorAction SilentlyContinue)) {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\gettext-iconv\bin"),
        (Join-Path $env:ProgramFiles "gettext-iconv\bin")
    )
    $bin = $candidates | Where-Object { Test-Path (Join-Path $_ "msgfmt.exe") } | Select-Object -First 1
    if (-not $bin) {
        Write-Host "GNU gettext not found. Install it with: winget install --id mlocati.GetText --exact" -ForegroundColor Red
        exit 1
    }
    $env:Path = "$bin;$env:Path"
}

Push-Location $backend
try {
    if (-not $CompileOnly) {
        New-Item -ItemType Directory -Force -Path (Join-Path $backend "locale") | Out-Null
        $langArgs = $languages | ForEach-Object { "--locale=$_" }
        # --add-location file: keep the file name but not the line number, so the .po files
        # only change when messages change. Test files are not translated.
        & $python manage.py makemessages @langArgs --add-location file --no-obsolete --ignore "tests.py"
        if ($LASTEXITCODE -ne 0) { exit 1 }
    }
    # --ignore .venv: only our own catalogs (Django's and DRF's are already compiled).
    & $python manage.py compilemessages --ignore ".venv"
    if ($LASTEXITCODE -ne 0) { exit 1 }
}
finally {
    Pop-Location
}
Write-Host "Translations updated." -ForegroundColor Green
