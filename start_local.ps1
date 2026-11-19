# Arranque local de SIGA: Core + 7 modulos + frontend Vite
# Requisito: PostgreSQL local corriendo con la base siga_core

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "siga_backend"
$frontend = Join-Path $root "siga_frontend"
$python = Join-Path $backend "venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    # Sin venv usamos el Python del sistema (o el lanzador py de Windows).
    Write-Host "AVISO: no existe $python - se usara el Python del sistema." -ForegroundColor Yellow
    $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        $python = "py"
        $pythonArgs = @("-3")
    } else {
        $sysPy = Get-Command python -ErrorAction SilentlyContinue
        if (-not $sysPy) {
            Write-Host "ERROR: no hay Python disponible. Instalalo o crea el venv con:" -ForegroundColor Red
            Write-Host "  py -3 -m venv siga_backend\venv" -ForegroundColor Yellow
            Write-Host "  siga_backend\venv\Scripts\python -m pip install -r siga_backend\requirements.txt" -ForegroundColor Yellow
            exit 1
        }
        $python = "python"
        $pythonArgs = @()
    }
    Write-Host "  (si algo falla, crealo con:  py -3 -m venv siga_backend\venv)" -ForegroundColor DarkGray
} else {
    $pythonArgs = @()
}

# Base de datos local
$env:DB_HOST     = "localhost"
$env:DB_PORT     = "5432"
$env:DB_USER     = "postgres"
$env:DB_PASSWORD = "wilson21"
$env:DB_NAME     = "siga_core"
$env:SKIP_MIGRATIONS = "true"

# Al ejecutar nativo no hay DNS de Docker: los manifests apuntan al nombre del
# servicio (mod-xxx). El core necesita saber que aqui todo vive en localhost.
$modulos = @(
    @{ n = "mod-usuarios";          p = 8001 },
    @{ n = "mod-planes-estudio";    p = 8002 },
    @{ n = "mod-programas-estudio"; p = 8005 },
    @{ n = "mod-gestion-academica"; p = 8006 },
    @{ n = "mod-auditoria";         p = 8007 },
    @{ n = "mod-evaluacion";        p = 8008 },
    @{ n = "mod-admision";          p = 8009 }
)

foreach ($m in $modulos) {
    $slug = $m.n
    if ($slug.StartsWith("mod-")) { $slug = $slug.Substring(4) }
    $clave = "SIGA_MODULE_" + $slug.Replace("-", "_").ToUpper() + "_URL"
    Set-Item -Path "Env:$clave" -Value "http://localhost:$($m.p)"
}

Write-Host " Levantando Core en http://localhost:8000  (docs: /docs)" -ForegroundColor Cyan
Start-Process -FilePath $python -WorkingDirectory $backend -ArgumentList `
    (@($pythonArgs) + @("-m","uvicorn","app.main:app","--host","0.0.0.0","--port","8000","--reload")) `
    -WindowStyle Minimized

Start-Sleep -Seconds 2

foreach ($m in $modulos) {
    $dir = Join-Path $backend "modules\$($m.n)"
    if (-not (Test-Path $dir)) { Write-Host "  (falta) $($m.n)" -ForegroundColor Red; continue }
    Write-Host " Levantando $($m.n) en http://localhost:$($m.p)" -ForegroundColor Cyan
    Start-Process -FilePath $python -WorkingDirectory $dir -ArgumentList `
        (@($pythonArgs) + @("-m","uvicorn","main:app","--host","0.0.0.0","--port","$($m.p)","--reload")) `
        -WindowStyle Minimized
    Start-Sleep -Milliseconds 700
}

Start-Sleep -Seconds 1
Write-Host " Levantando frontend (Vite)" -ForegroundColor Cyan
Start-Process -FilePath "npm" -WorkingDirectory $frontend -ArgumentList "run","dev" -WindowStyle Minimized

Write-Host ""
Write-Host " Todo lanzado. Espera ~10s y abre:" -ForegroundColor Green
Write-Host "   Frontend : http://localhost:5173"
Write-Host "   API docs : http://localhost:8000/docs"
Write-Host "   Login    : admin@siga.edu / admin123"
Write-Host ""
Write-Host " Para detener: cierra las ventanas, o ejecuta stop_local.ps1" -ForegroundColor DarkGray
