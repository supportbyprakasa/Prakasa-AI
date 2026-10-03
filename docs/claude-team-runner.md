# Claude Team runner — menjaga Prakasa AI tetap stabil di satu seat

Status: keputusan owner 29 September 2026. Prakasa AI tetap memakai Claude Team, dengan **1 seat** yang berjalan di **Mac owner** dulu, lalu pindah ke **VPS** sebelum dipakai seluruh karyawan.

## Kenapa perlu runner

Backend produksi berjalan di **GoDaddy shared cPanel**: tanpa SSH, dan prosesnya dikelola Passenger. Di sana Claude CLI tidak bisa dipasang dan di-login dengan andal. Karena itu CLI dijalankan di mesin lain yang selalu menyala, yaitu **runner**, dan dipanggil backend lewat HTTPS.

```
Browser ──► Backend (cPanel) ──HTTPS──► Runner (Mac/VPS) ──► Claude CLI (login seat Team)
                ▲                                              │ alat Prakasa (MCP)
                └──────────── HTTPS /api/v1/ai-agent ◄─────────┘  token agen 15 menit
```

## Apa yang menjaga stabilitas

| Masalah | Penanganan | Kode |
|---|---|---|
| Banyak user bertanya bersamaan | Antrean: maksimal `CLAUDE_TEAM_MAX_CONCURRENT` (default 2) jawaban bersamaan, sisanya menunggu, dan user melihat "menunggu giliran (n di depan Anda)". Antrean penuh atau terlalu lama menghasilkan pesan yang jelas | `services/ai/cliQueue.js` |
| Kuota seat habis (batas 5 jam / mingguan) | Setiap jawaban mencatat `rate_limit_info`. Saat habis (`rejected`), CLI **tidak dipanggil lagi** sampai jam reset, dan user diberi tahu "bisa dipakai lagi sekitar Kamis 2 Okt 14.00 WIB". Super Admin diberi peringatan sekali per periode saat pemakaian ≥ 80% dan saat kuota habis | `services/ai/claudeTeamLimits.js` |
| CLI crash / runner sesaat tidak terjangkau | Dicoba ulang satu kali, tetapi tidak pernah setelah teks mulai mengalir | `claudeTeamPersonal.js` (`guarded`, `streamGateway`) |
| Login seat kedaluwarsa | Terdeteksi dari jawaban dan dari cek berkala. Super Admin mendapat notifikasi, dan user mendapat pesan "Akun Claude Team di server belum login" | `claudeTeamLimits.recordLogin`, `jobs/claudeTeamHealth.js` |
| Runner mati | Dijalankan ulang otomatis oleh launchd (Mac) atau systemd (VPS). Cek berkala menandai "Runner tidak terjangkau" | `deploy/id.prakasa.claude-runner.plist` |
| Runner versi lama | Backend otomatis memakai `/generate` (tanpa streaming dan alat) | `streamGateway` |

Status setiap seat (login, pemakaian %, jam reset, antrean) tampil di **Administrasi → AI Provider & Engine**.

## Pemasangan di Mac owner (tahap sekarang)

> Langkah 3–5 mengubah pengaturan Mac dan membuka jalur dari internet. Lakukan hanya setelah owner menyetujuinya.

1. **Login seat Claude Team di Mac:** `claude auth login`, lalu periksa dengan `claude auth status`. `subscriptionType` harus `team`.
2. **Secret runner:** isi `CLAUDE_TEAM_GATEWAY_SECRET` (minimal 24 karakter acak) di `backend/.env` Mac. Secret yang sama nanti dimasukkan ke akun gateway di aplikasi. Jangan kirim lewat chat.
3. **Jalankan sebagai layanan:** salin `backend/deploy/id.prakasa.claude-runner.plist` ke `~/Library/LaunchAgents/`, ganti path dan USERNAME, lalu `launchctl load ~/Library/LaunchAgents/id.prakasa.claude-runner.plist`. Periksa dengan `curl http://127.0.0.1:3199/health`, yang harus menjawab `{"status":"ok","version":2}`.
4. **Mac jangan tidur:** System Settings → Energy (atau Battery → Options), aktifkan "Prevent automatic sleeping when the display is off", dan pastikan Mac tersambung ke listrik.
5. **Jalur HTTPS ke runner**, tanpa membuka port router. Pilih satu:
   - **Cloudflare Tunnel** (gratis, paling stabil). Syaratnya DNS `prakasa-work-os.com` dikelola Cloudflare. Hasilnya mis. `https://ai-runner.prakasa-work-os.com` → `http://127.0.0.1:3199`.
   - **ngrok** dengan domain statis gratis, atau **Tailscale Funnel**. Keduanya tidak perlu memindah DNS, dan alamatnya tetap.
   - Jangan memakai alamat tunnel sementara yang berubah setiap restart.
6. **Daftarkan di aplikasi:** Administrasi → AI Provider & Engine → Tambah akun → mode **gateway**, isi URL HTTPS runner dan secret dari langkah 2, lalu atur routing divisi ke akun ini.
7. **Backend produksi:** set `PRAKASA_AGENT_API_URL=https://api.prakasa-work-os.com/api/v1`, supaya alat agen di runner bisa memanggil balik.
8. **Cron cPanel setiap 5 menit:** `node src/jobs/claudeTeamHealth.js` (lewat `cron-wrapper.sh` seperti job lain).

## Pindah ke VPS (tahap berikutnya)

Prosesnya sama: salin repo backend, `npm ci`, `claude auth login`, isi `.env` runner, lalu jalankan `node src/scripts/claudeTeamGateway.js` sebagai layanan **systemd** (`Restart=always`). Terakhir, arahkan tunnel atau domain ke VPS dan ganti URL di akun gateway. Tidak ada perubahan kode.

## Batasan yang perlu diketahui owner

- **Satu seat = satu kuota.** Antrean dan jeda otomatis membuat pengalaman tetap rapi, tetapi tidak menambah kuota. Bila jeda sering terjadi, pilihannya adalah menambah seat (failover per akun sudah didukung routing divisi) atau pindah ke Claude API.
- **Seat Team pada dasarnya untuk satu orang.** `.env.example` sudah memperingatkan agar satu seat tidak dijadikan layanan produksi multi-user. Pemakaian yang sangat tinggi dari satu seat berisiko dibatasi atau diblokir oleh penyedia. Ini juga risiko stabilitas.
