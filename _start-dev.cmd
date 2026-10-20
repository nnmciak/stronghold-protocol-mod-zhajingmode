@echo off
cd /d "C:\Users\???\Desktop\100wei(beta0.1)\Stronghold-Protocol"
set PORT=3000
set SP_DEV_NOCACHE=1
"C:\Users\???\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" server\index.js > "C:\Users\???\Desktop\100wei(beta0.1)\Stronghold-Protocol\_devserver.log" 2>&1
