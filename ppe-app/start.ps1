# PPE Detection System — start all three services
# Usage: .\start.ps1

$root = Split-Path -Parent $MyInvocation.MyCommand.Definition

# Terminal 1 — Python YOLO service
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\yolo-service'; python app.py"

# Terminal 2 — Node.js server
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\server'; node server.js"

# Terminal 3 — React frontend (Vite)
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$root\client'; npm run dev"

Write-Host ""
Write-Host "All three services are starting in separate windows:"
Write-Host "  Python YOLO  -> http://localhost:5001"
Write-Host "  Node server  -> http://localhost:5000"
Write-Host "  React app    -> http://localhost:3000"
