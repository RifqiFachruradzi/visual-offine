# Visual Office — Kantor Agent AI

Visualisasi kantor 2D (gaya pixel) yang karyawannya adalah **agent AI** (ditenagai Gemini, gratis). Mirip `claude-office`, tapi milikmu sendiri: kamu bisa
mengatur bentuk kantor, menambah **divisi**, **departemen**, merekrut **agen**, dan ada **Boss** yang memberi perintah.

## Fitur

| Fitur | Keterangan |
|---|---|
| **Login** | Halaman login; semua halaman & API dikunci di sisi server (cookie bertanda tangan + Vercel Middleware). Akun diatur lewat `APP_USERNAME` / `APP_PASSWORD`. |
| **Kamu = Boss** | Akun yang login otomatis menjadi Boss. Data kantor tersimpan terpisah per akun. |
| **Mulai dari kosong** | Kantor baru hanya berisi Ruang Boss, Ruang Rapat, dan Pantry — cocok untuk demo menambah divisi & karyawan. Tombol **Contoh** memuat kantor contoh, **Kosongkan** mulai dari nol lagi. |
| **Hierarki kantor** | Kamu (Boss) → Direktur Divisi → Ketua Tim (lead) → Anggota. Setiap level briefing ke atasan, bekerja di mejanya, lalu melapor balik. |
| **Divisi & Departemen** | Tambah / edit / hapus divisi (zona berwarna) dan departemen (ruangan dengan meja otomatis). |
| **Agen AI** | Nama, jabatan, model (**Gemini Flash / Flash-Lite / Pro** — gratis; Claude opsional), *system prompt* / kepribadian, warna baju-rambut-kulit, pindah departemen, jadikan lead. |
| **Editor layout** | Geser ruangan & zona, ubah ukuran (pojok kanan-bawah), tambah Ruang Rapat / Pantry / Lounge, taruh furnitur (tanaman, sofa, rak buku, whiteboard, dispenser, printer, server, arcade), ganti lantai, ukuran peta, **Tata Otomatis**. |
| **Perintah Boss** | Beri tugas ke seluruh kantor (ada rapat besar di ruang rapat), satu divisi, satu tim, atau satu agen. Lihat progres & hasil tiap agen. |
| **Mode simulasi** | Jalan tanpa internet/API: karyawan ngopi, ngobrol, brainstorm, dan mengerjakan tugas secara simulasi. |
| **Mode AI nyata** | Setiap agen benar-benar memanggil **Gemini** (free tier) dengan persona & jabatannya; lead & direktur merangkum laporan timnya, Boss membuat ringkasan eksekutif. Panggilan diantrekan sesuai batas per menit & otomatis dicoba ulang saat kena rate limit. |
| **Simpanan (ingatan agen)** | Tiap agen mengingat 6 hasil kerja terakhirnya dan memakainya sebagai konteks di tugas berikutnya. Lihat / hapus di Inspector. |
| **Gudang Dokumen** | Semua laporan & hasil kerja tersimpan otomatis. Unggah file `.txt`/`.md` (SOP, panduan brand, data produk) — agen otomatis membaca dokumen yang relevan dengan tugasnya. Bisa dicari, diunduh `.md`, dihapus. |
| **Live Claude Code** | Sesi Claude Code-mu muncul sebagai karyawan: menerima prompt dari Boss, memakai tool (Edit, Bash, …) di mejanya, lalu melapor saat selesai. |
| **Simpan** | Kantor, ingatan, dan dokumen tersimpan otomatis di browser (localStorage, gratis, tanpa database), plus Export / Import file JSON. |

## Cara menjalankan

### Opsi A — paling cepat (offline, mode simulasi)
Buka `index.html` langsung di browser. Selesai.

### Opsi B — server lokal (mode AI + live Claude Code)
Butuh Node.js 20.12+.

```bash
npm install
cp .env.example .env        # isi GEMINI_API_KEY (gratis: https://aistudio.google.com/apikey)
npm start                   # → http://localhost:4317
```

Lalu centang **Mode AI nyata** di bar atas. Tanpa API key, aplikasi tetap jalan dalam mode simulasi.

### Opsi C — deploy ke Vercel
Proyek ini siap Vercel tanpa konfigurasi build: file statis + Vercel Functions di `api/` (`api/health.js`, `api/run.js`).

1. Di [vercel.com/new](https://vercel.com/new) → **Import** repo `visual-offine` dari GitHub.
2. **Framework Preset:** `Other` (sudah dipaksa lewat `vercel.json`). Build Command & Output Directory biarkan default.
3. **Environment Variables:** tambahkan (centang Production & Preview):
   - `GEMINI_API_KEY` = kunci dari Google AI Studio
   - `APP_USERNAME` = nama login kamu (juga jadi nama Boss)
   - `APP_PASSWORD` = password login
   - opsional `APP_SECRET` = string acak panjang untuk menandatangani cookie
4. Klik **Deploy**. Buka URL-nya → pill di bar atas harus menunjukkan **Gemini siap**.
5. Pilih branch yang dideploy: *Production Branch* default `main`; jika belum ada `main`, set di
   **Settings → Git → Production Branch** atau merge branch ini ke `main`.

Catatan Vercel:
- Fitur **Live Claude Code** (hooks) hanya tersedia di server lokal, karena butuh koneksi SSE yang terus hidup.
- Ingatan & dokumen tersimpan di **browser tiap pengguna** (localStorage). Gunakan Export/Import untuk memindahkan antar perangkat.
- Tanpa `APP_USERNAME`/`APP_PASSWORD`, deployment Vercel **terkunci total** (halaman login menampilkan pesan setup).
  Login melindungi halaman dan `/api/run`, jadi kuota Gemini hanya bisa dipakai akun yang login.

### Model & kuota gratis
| Variabel | Default | Keterangan |
|---|---|---|
| `GEMINI_API_KEY` | – | Wajib untuk mode AI. |
| `GEMINI_MODEL` | `gemini-flash-latest` | Model untuk agen yang modelnya tidak dikenali. Alias `*-latest` selalu menunjuk versi terbaru. |
| `LLM_MAX_OUTPUT_TOKENS` | `2048` | Batas token jawaban per agen. |
| `ANTHROPIC_API_KEY` | – | Opsional: agen yang memilih model Claude memakai Claude. |

Free tier Gemini dibatasi per menit & per hari. Atur **batas panggilan/menit** di bar atas (default 10/mnt). Satu tugas
"Seluruh kantor" = 1 panggilan per agen + ringkasan per lead/direktur/Boss (±30 panggilan di kantor contoh) — untuk hemat
kuota, beri tugas per tim atau pakai model Flash-Lite.

### Hubungkan Claude Code (live)
1. Jalankan `npm start`.
2. Salin isi `hooks/settings.example.json` ke `~/.claude/settings.json` (atau `.claude/settings.json` di proyekmu),
   ganti `/PATH/KE/visual-offine` dengan lokasi folder ini.
3. Pakai Claude Code seperti biasa — setiap sesi muncul di divisi **Live · Claude Code**.

Hook tidak pernah memblokir Claude Code (timeout 1,5 detik, selalu exit 0). Ubah alamat server dengan `VISUAL_OFFICE_URL`.

## Kontrol

| Aksi | Cara |
|---|---|
| Zoom | Scroll mouse |
| Geser kamera | Drag area kosong / klik kanan-drag |
| Pilih karyawan / ruangan | Klik (atau klik di pohon organisasi) |
| Edit karyawan | Klik 2× pada karyawan |
| Mode edit layout | Tombol **Edit Layout** atau tombol `E` |
| Lihat seluruh kantor | `F` atau tombol ⤢ |
| Hapus yang dipilih | `Delete` |
| Kirim tugas cepat | `Ctrl/Cmd + Enter` di kotak perintah |

## Struktur kode

```
index.html          UI utama
css/style.css       tampilan
js/model.js         data organisasi, layout, ingatan agen, gudang dokumen, simpan/muat
js/sim.js           grid jalan, pathfinding (BFS), perilaku karyawan
js/tasks.js         alur tugas hierarkis + pemetaan event live Claude Code
js/icons.js         ikon SVG (pengganti emoji) untuk HTML & canvas
js/ai.js            klien ke backend (/api/run, /api/events) + antrean rate limit
js/render.js        renderer canvas (lantai, dinding, meja, karakter, balon chat)
js/ui.js            panel organisasi, inspector, daftar tugas, dialog
js/main.js          bootstrap, game loop, kamera & editor
lib/llm.js          lapisan LLM bersama (Gemini / Claude), dipakai lokal & Vercel
api/                Vercel Functions: health, run, login, logout, me
middleware.js       Vercel Routing Middleware: wajib login untuk semua halaman
lib/auth.js         sesi login (HMAC, Web Crypto) dipakai middleware, functions & server lokal
login.html          halaman login
local/server.js     server lokal: statis + /api/run + jembatan event (SSE)
vercel.json         konfigurasi Vercel
hooks/              hook Claude Code → Visual Office
```

## API server

| Endpoint | Fungsi |
|---|---|
| `GET /api/health` | Status mode AI & provider |
| `POST /api/run` `{model, system, prompt}` | Jalankan satu agen, respons streaming SSE (`text` / `done` / `error`) |
| `POST /api/event` | Kirim event (format hook Claude Code: `hook_event_name`, `session_id`, `tool_name`, …) |
| `GET /api/events` | Langganan event live (SSE) |

`/api/event` & `/api/events` hanya ada di server lokal. Server lokal mendengarkan `127.0.0.1` secara default (ubah dengan `HOST=0.0.0.0` bila perlu — hati-hati, `/api/run` memakai API key-mu).
