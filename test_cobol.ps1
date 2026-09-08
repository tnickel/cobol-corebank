$mPath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
$uPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$env:PATH = "$uPath;$mPath"
$env:COB_CONFIG_DIR = [System.Environment]::GetEnvironmentVariable("COB_CONFIG_DIR", "User")
$env:COB_COPY_DIR = [System.Environment]::GetEnvironmentVariable("COB_COPY_DIR", "User")
$env:COB_CFLAGS = [System.Environment]::GetEnvironmentVariable("COB_CFLAGS", "User")
$env:COB_LDFLAGS = [System.Environment]::GetEnvironmentVariable("COB_LDFLAGS", "User")

Write-Host "cobc binary:" (Get-Command cobc.exe).Source
Write-Host "Testing COBOL compilation..."

cobc -x -o hello.exe hello.cob
if ($LASTEXITCODE -eq 0) {
    Write-Host "Compilation SUCCESS!"
    Write-Host "Running hello.exe:"
    .\hello.exe
} else {
    Write-Error "Compilation FAILED with code $LASTEXITCODE"
}
