# LedgerFlow Accounting — Desktop App Launcher
$projectDir = "C:\Users\lenovo\Documents\AI GAAI projects\ledgerflow-accounting-main"
Set-Location $projectDir

$port = 6185
$portActive = netstat -ano | findstr ":$port " | findstr "LISTENING"

if (!$portActive) {
    # Start the dev server in a hidden CMD window
    Start-Process cmd -ArgumentList "/c npm run dev -- --port $port" -WindowStyle Hidden -WorkingDirectory $projectDir

    # Wait for the port to become active (up to 45 seconds)
    $timeout = 45
    while (!(netstat -ano | findstr ":$port " | findstr "LISTENING") -and $timeout -gt 0) {
        Start-Sleep -Seconds 1
        $timeout--
    }
}

# Launch in Edge App Mode (looks like a native desktop app)
Start-Process "msedge.exe" -ArgumentList "--app=http://localhost:$port"
