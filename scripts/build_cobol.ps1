# Build script for GnuCOBOL with GixSQL (Embedded SQL) and PostgreSQL
$ErrorActionPreference = "Stop"

$base = "C:\Users\tnickel\AppData\Local\Programs\GnuCOBOL 3.2"
$env:PATH = "$base\bin;$base\mingw64\bin;" + $env:PATH
$env:COB_CONFIG_DIR = "$base\config"
$env:COB_COPY_DIR = "$base\copy"
$env:COB_CFLAGS = "-I `"$base\include`""
$env:COB_LDFLAGS = "-L `"$base\lib`""

$projectRoot = Split-Path -Parent $PSScriptRoot
$srcDir = Join-Path $projectRoot "src\cobol"
$binDir = Join-Path $projectRoot "bin"

if (!(Test-Path $binDir)) {
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
}

$sqbFile = Join-Path $srcDir "cobol_bank.sqb"
$cblFile = Join-Path $binDir "cobol_bank.cbl"
$exeFile = Join-Path $binDir "cobol_bank.exe"

Write-Host "==> 1. Preprocessing $sqbFile with GixSQL..." -ForegroundColor Cyan
& "$base\bin\gixpp.exe" -e -S -i $sqbFile -o $cblFile -I "$base\copy"
if ($LASTEXITCODE -ne 0) {
    Write-Error "GixSQL preprocessing failed with code $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "==> 2. Compiling $cblFile to $exeFile with GnuCOBOL..." -ForegroundColor Cyan
& "$base\bin\cobc.exe" -x -o $exeFile $cblFile -L "$base\lib" -llibgixsql
if ($LASTEXITCODE -ne 0) {
    Write-Error "GnuCOBOL compilation failed with code $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "==> 3. Build SUCCESS: $exeFile created successfully!" -ForegroundColor Green
