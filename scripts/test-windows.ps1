# RilleCode Windows Test Runner
# Ensures correct git config and runs the full agent test suite

Write-Host "Configuring git for test consistency..."
git config --global core.autocrlf false

Write-Host "Running agent tests..."
npx vitest run tests/agent/

if ($LASTEXITCODE -eq 0) {
    Write-Host "All tests passed."
} else {
    Write-Host "Some tests failed. Check output above."
    exit $LASTEXITCODE
}
