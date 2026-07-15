#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/Shuumy/WAVE/main"
INSTALL_DIR="$HOME/.local/share/wave-samsung"
BIN_DIR="$PREFIX/bin"
BRIDGE_FILE="$INSTALL_DIR/wave_bridge.py"

printf '\n[WAVE] Mise à jour des paquets Termux…\n'
pkg update -y
pkg upgrade -y

printf '\n[WAVE] Installation de Python, yt-dlp et ffmpeg…\n'
pkg install -y python python-pip ffmpeg nodejs-lts curl
python -m pip install --upgrade pip
python -m pip install --upgrade "yt-dlp[default]"

mkdir -p "$INSTALL_DIR" "$HOME/.config/wave-bridge"
curl -fsSL "$REPO_RAW/android/wave_bridge.py" -o "$BRIDGE_FILE"
chmod 700 "$BRIDGE_FILE"

cat > "$BIN_DIR/wave-start" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
set -u
termux-wake-lock 2>/dev/null || true
cleanup() {
  termux-wake-unlock 2>/dev/null || true
}
trap cleanup EXIT INT TERM
python "$HOME/.local/share/wave-samsung/wave_bridge.py"
EOF
chmod 700 "$BIN_DIR/wave-start"

cat > "$BIN_DIR/wave-update" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
REPO_RAW="https://raw.githubusercontent.com/Shuumy/WAVE/main"
python -m pip install --upgrade "yt-dlp[default]"
curl -fsSL "$REPO_RAW/android/wave_bridge.py" -o "$HOME/.local/share/wave-samsung/wave_bridge.py"
chmod 700 "$HOME/.local/share/wave-samsung/wave_bridge.py"
printf '\nWAVE et yt-dlp sont à jour.\n'
EOF
chmod 700 "$BIN_DIR/wave-update"

cat > "$BIN_DIR/wave-test" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
curl -fsS http://127.0.0.1:8765/api/health && printf '\n'
EOF
chmod 700 "$BIN_DIR/wave-test"

printf '\n============================================================\n'
printf 'Installation terminée.\n\n'
printf '1. Lance le pont avec :  wave-start\n'
printf '2. Laisse Termux ouvert.\n'
printf '3. Ouvre WAVE et touche la carte « Pont Samsung ».\n'
printf '4. Pour mettre à jour plus tard :  wave-update\n'
printf '============================================================\n\n'
