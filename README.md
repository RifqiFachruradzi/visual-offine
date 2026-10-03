# 🏢 Visual Office — Kantor Agent AI

Visualisasi kantor 2D (gaya pixel) yang karyawannya adalah **agent AI**. Mirip `claude-office`, tapi milikmu sendiri: kamu bisa
mengatur bentuk kantor, menambah **divisi**, **departemen**, merekrut **agen**, dan ada **Boss** yang memberi perintah.

## ✨ Fitur

| Fitur | Keterangan |
|---|---|
| 👑 **Hierarki kantor** | Boss (CEO) → Direktur Divisi → Ketua Tim (lead) → Anggota. Setiap level briefing ke atasan, bekerja di mejanya, lalu melapor balik. |
| 🏛 **Divisi & Departemen** | Tambah / edit / hapus divisi (zona berwarna) dan departemen (ruangan dengan meja otomatis). |
| 🤖 **Agen AI** | Nama, jabatan, model (Opus 5.5 / Sonnet 5.5 / Haiku 4.5), *system prompt* / kepribadian, warna baju-rambut-kulit, pindah departemen, jadikan lead. |
| ✏️ **Editor layout** | Geser ruangan & zona, ubah ukuran (pojok kanan-bawah), tambah Ruang Rapat / Pantry / Lounge, taruh furnitur (tanaman, sofa, rak buku, whiteboard, dispenser, printer, server, arcade), ganti lantai, ukuran peta, **🪄 Tata Otomatis**. |
| 📋 **Perintah Boss** | Beri tugas ke seluruh kantor (ada rapat besar di ruang rapat), satu divisi, satu tim, atau satu agen. Lihat progres & hasil tiap agen. |
| 🎲 **Mode simulasi** | Jalan tanpa internet/API: karyawan ngopi, ngobrol, brainstorm, dan mengerjakan tugas secara simulasi. |
| 🧠 **Mode AI nyata** | Setiap agen benar-benar memanggil **Claude API** dengan persona & jabatannya; lead & direktur merangkum laporan timnya, Boss membuat ringkasan eksekutif. |
| 🟠 **Live Claude Code** | Sesi Claude Code-mu muncul sebagai karyawan: menerima prompt dari Boss, memakai tool (Edit, Bash, …) di mejanya, lalu melapor saat selesai. |
| 💾 **Simpan** | Tersimpan otomatis di browser (localStorage), plus Export / Import file JSON. |

## 🚀 Cara menjalankan

### Opsi A — paling cepat (offline, mode simulasi)
Buka `index.html` langsung di browser. Selesai.

### Opsi B — server lokal (mode AI + live Claude Code)
Butuh Node.js 18+.

```bash
npm install                      # memasang @anthropic-ai/sdk (opsional, untuk mode AI)
export ANTHROPIC_API_KEY=sk-ant-...   # opsional, untuk mode AI nyata
npm start                        # → http://localhost:4317
```

Lalu centang **Mode AI nyata** di bar atas. Tanpa API key, server tetap jalan dalam mode simulasi + live.

> Mode AI memakai `claude-opus-5-5` sebagai default (bisa diganti per agen). Untuk Opus/Sonnet, server mengaktifkan
> `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) agar permintaan yang ditolak model otomatis dicoba ulang
> dengan model cadangan. Setiap agen memakai `effort: "medium"` dan maksimal 4000 token output — ubah di `server.js`.
> Perhatikan biaya: satu tugas "Seluruh kantor" memanggil API sekali per agen + ringkasan per lead/direktur/Boss.

### Hubungkan Claude Code (live)
1. Jalankan `npm start`.
2. Salin isi `hooks/settings.example.json` ke `~/.claude/settings.json` (atau `.claude/settings.json` di proyekmu),
   ganti `/PATH/KE/visual-offine` dengan lokasi folder ini.
3. Pakai Claude Code seperti biasa — setiap sesi muncul di divisi **Live · Claude Code**.

Hook tidak pernah memblokir Claude Code (timeout 1,5 detik, selalu exit 0). Ubah alamat server dengan `VISUAL_OFFICE_URL`.

## 🎮 Kontrol

| Aksi | Cara |
|---|---|
| Zoom | Scroll mouse |
| Geser kamera | Drag area kosong / klik kanan-drag |
| Pilih karyawan / ruangan | Klik (atau klik di pohon organisasi) |
| Edit karyawan | Klik 2× pada karyawan |
| Mode edit layout | Tombol **✏️ Edit Layout** atau tombol `E` |
| Lihat seluruh kantor | `F` atau tombol ⤢ |
| Hapus yang dipilih | `Delete` |
| Kirim tugas cepat | `Ctrl/Cmd + Enter` di kotak perintah |

## 🗂 Struktur kode

```
index.html          UI utama
css/style.css       tampilan
js/model.js         data organisasi, layout ruangan, simpan/muat
js/sim.js           grid jalan, pathfinding (BFS), perilaku karyawan
js/tasks.js         alur tugas hierarkis + pemetaan event live Claude Code
js/ai.js            klien ke server (/api/run, /api/events)
js/render.js        renderer canvas (lantai, dinding, meja, karakter, balon chat)
js/ui.js            panel organisasi, inspector, daftar tugas, dialog
js/main.js          bootstrap, game loop, kamera & editor
server.js           server statis + Claude API + jembatan event (SSE)
hooks/              hook Claude Code → Visual Office
```

## 🔌 API server

| Endpoint | Fungsi |
|---|---|
| `GET /api/health` | Status mode AI |
| `POST /api/run` `{model, system, prompt}` | Jalankan satu agen, respons streaming SSE (`text` / `done` / `error`) |
| `POST /api/event` | Kirim event (format hook Claude Code: `hook_event_name`, `session_id`, `tool_name`, …) |
| `GET /api/events` | Langganan event live (SSE) |

Server hanya mendengarkan `127.0.0.1` secara default (ubah dengan `HOST=0.0.0.0` bila perlu — hati-hati, `/api/run` memakai API key-mu).
