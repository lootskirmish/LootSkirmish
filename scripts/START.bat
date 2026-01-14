@echo off
echo ============================================================
echo    LOOT SKIRMISH - Iniciando Servidor Local
echo ============================================================
echo.

REM Verificar se node_modules existe
if not exist "node_modules\" (
    echo [1/3] Instalando dependencias...
    call npm install
    echo.
) else (
    echo [1/3] Dependencias ja instaladas
    echo.
)

echo [2/3] Iniciando servidor da API (porta 3000)...
start "API Server" cmd /k "npm run server"

timeout /t 3 /nobreak >nul

echo [3/3] Iniciando servidor do Frontend (porta 5173)...
start "Frontend Server" cmd /k "npm run dev"

echo.
echo ============================================================
echo    Servidores iniciados!
echo ============================================================
echo.
echo    API:      http://localhost:3000
echo    Frontend: http://localhost:5173
echo.
echo    Pressione qualquer tecla para fechar este terminal...
echo    (Os servidores continuarao rodando nas outras janelas)
echo ============================================================
pause >nul
