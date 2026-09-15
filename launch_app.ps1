# LedgerFlow Accounting — Desktop App Launcher
$projectDir = "C:\Users\lenovo\Documents\AI GAAI projects\ledgerflow-accounting-main"
Set-Location $projectDir

$port = 6185
$url = "http://localhost:$port"
$logPath = Join-Path $projectDir "server.log"

function Test-ServerHealthy([string]$targetUrl) {
    try {
        $req = [System.Net.HttpWebRequest]::Create($targetUrl)
        $req.Timeout = 1200
        $req.Method = "GET"
        $resp = $req.GetResponse()
        $resp.Close()
        return $true
    } catch {
        return $false
    }
}

function Test-PortOpen([int]$p) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect("127.0.0.1", $p, $null, $null)
        $success = $iar.AsyncWaitHandle.WaitOne(500)
        if ($success) {
            $tcp.EndConnect($iar)
            $tcp.Close()
            return $true
        }
        $tcp.Close()
        return $false
    } catch {
        return $false
    }
}

# 1. Check if server is already running and responding
$isHealthy = Test-ServerHealthy $url

if (!$isHealthy) {
    # If the port is open but unresponsive, terminate the zombie process
    if (Test-PortOpen $port) {
        $procMatches = netstat -ano | findstr ":$port" | findstr "LISTENING"
        foreach ($line in $procMatches) {
            $parts = $line.Trim() -split "\s+"
            $pidToKill = $parts[-1]
            if ($pidToKill -match "^\d+$" -and [int]$pidToKill -gt 0) {
                Stop-Process -Id [int]$pidToKill -Force -ErrorAction SilentlyContinue
            }
        }
        Start-Sleep -Milliseconds 600
    }

    # Start the dev server in the background
    Start-Process powershell.exe -ArgumentList "-WindowStyle Hidden -NoProfile -Command Set-Location '$projectDir'; npm run dev -- --port $port --host 127.0.0.1 > '$logPath' 2>&1" -WorkingDirectory $projectDir

    # Wait for the server to become healthy (up to 30 seconds, polling every 500ms)
    $maxAttempts = 60
    $attempts = 0
    while ($attempts -lt $maxAttempts) {
        Start-Sleep -Milliseconds 500
        $attempts++
        if (Test-ServerHealthy $url) {
            $isHealthy = $true
            break
        }
    }
}

# 2. Locate browser and launch in app mode
$browserPaths = @(
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

$foundBrowser = $browserPaths | Where-Object { ! [string]::IsNullOrEmpty($_) -and (Test-Path $_) } | Select-Object -First 1

if ($foundBrowser) {
    Start-Process $foundBrowser -ArgumentList "--app=$url"
} else {
    Start-Process $url
}
