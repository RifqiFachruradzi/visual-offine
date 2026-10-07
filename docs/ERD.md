# ERD — Visual Office & Integrasi Aplikasi Divisi

Dokumen ini menggambarkan struktur data **Visual Office** (kantor agen AI) dan bagaimana setiap
divisi menarik data (hanya baca) dari aplikasi operasional:

| Divisi | Aplikasi sumber | Repo | Penyimpanan data saat ini |
|---|---|---|---|
| Logistic | Logistic Management System | `RifqiFachruradzi/logistic-management-system` | Browser `localStorage` key `lms-store-trial-v1` (Zustand) |
| Accounting | Laporan Keuangan App | `RifqiFachruradzi/laporan-keuangan-app` | **Supabase Postgres** (tabel `accounts`, `journals`, `journal_entries`, RLS per `user_id`) |
| Procurement | Procurement Management System | `RifqiFachruradzi/procurement-management-system` | Browser `localStorage` key `procura.pms.v2` (Zustand, versi 3) |
| Ekspedisi | Ekspedisi App | `RifqiFachruradzi/ekspedisi-app` | Browser `localStorage` key `ekspedisi-app-state` |
| _(sudah ada)_ Minimarket | MiniMarket APP | `RifqiFachruradzi/MIniMarket-APP` | Turso / libSQL |
| _(sudah ada)_ Gudang | Gudang-Document | `RifqiFachruradzi/Gudang-Document` | Upstash Redis `gudang:*` |
| _(berikutnya)_ … | aplikasi baru | — | didaftarkan lewat **Connector Registry** (lihat bagian 2) |

Isi dokumen:
1. [ERD inti Visual Office](#1-erd-inti-visual-office)
2. [ERD lapisan integrasi (extensible, banyak aplikasi per divisi)](#2-erd-lapisan-integrasi)
3. [ERD aplikasi sumber](#3-erd-aplikasi-sumber) — Logistic, Accounting, Procurement, Ekspedisi
4. [Relasi lintas aplikasi (alur bisnis)](#4-relasi-lintas-aplikasi)
5. [Kamus data ringkas & catatan teknis integrasi](#5-catatan-teknis-integrasi)

> Notasi: diagram memakai Mermaid `erDiagram` (tampil otomatis di GitHub). Versi gambar PNG ada di folder [`docs/erd/`](erd/).
> `PK` primary key, `FK` foreign key, `UK` unique. Entitas bertanda _embedded_ disimpan di dalam
> dokumen JSON induknya (bukan tabel terpisah) tetapi digambar sebagai entitas agar relasinya jelas.

---

## 1. ERD inti Visual Office

Visual Office menyimpan satu dokumen kantor per akun di Upstash Redis
(`visualoffice:office:<email>`), dokumen di hash `visualoffice:docs:<email>`, dan akun di
`visualoffice:users`. Secara logis strukturnya:

```mermaid
erDiagram
    USER_ACCOUNT ||--|| OFFICE : "memiliki (1 akun = 1 kantor = Boss)"
    OFFICE ||--|| OFFICE_SETTINGS : "pengaturan"
    OFFICE ||--o{ FACILITY : "ruangan umum"
    OFFICE ||--o{ DIVISION : "divisi"
    OFFICE ||--o{ FURNITURE : "dekorasi"
    OFFICE ||--o{ TASK : "perintah Boss"
    OFFICE ||--o{ DOCUMENT : "gudang dokumen"
    OFFICE ||--o{ ACTIVITY_LOG : "log aktivitas"
    DIVISION ||--o{ DEPARTMENT : "berisi"
    DIVISION ||--o| AGENT : "direktur (0..1)"
    DEPARTMENT ||--o{ AGENT : "anggota (lead = isLead)"
    AGENT ||--o{ AGENT_MEMORY : "ingatan"
    AGENT ||--o{ CHAT_MESSAGE : "chat dengan Boss"
    TASK ||--o{ SUBTASK : "dipecah ke agen"
    AGENT ||--o{ SUBTASK : "mengerjakan"
    TASK ||--o{ DOCUMENT : "menghasilkan laporan"
    AGENT ||--o{ DOCUMENT : "penulis"
    DEPARTMENT ||--o{ DOCUMENT : "pemilik"

    USER_ACCOUNT {
        string email PK "lowercase"
        string name "nama Boss"
        string passwordHash "scrypt"
        datetime createdAt
    }
    OFFICE {
        string ownerEmail PK,FK
        string companyName
        int mapW
        int mapH
        int version
    }
    OFFICE_SETTINGS {
        string ownerEmail PK,FK
        string theme "studio|luxe|classic|robot|modern|pixel"
        string view "2d|3d"
        string layout "open|rooms"
        boolean aiMode
        int rpm "batas panggilan AI/menit"
        float speed
        string city "kota data cuaca"
    }
    FACILITY {
        string id PK
        string type "boss|meeting|pantry|lounge|pool|billiard"
        string name
        int x
        int y
        int w
        int h
        string color
    }
    DIVISION {
        string id PK
        string name
        string color
        string integration FK "connector default divisi (lihat bagian 2)"
        string dirPos "left|center|right"
        json zone "x,y,w,h"
        json directorDesk "x,y"
    }
    DEPARTMENT {
        string id PK
        string divisionId FK
        string name
        string integration FK "override connector (opsional)"
        json room "x,y,w,h"
    }
    AGENT {
        string id PK "'boss' untuk Boss"
        string divisionId FK
        string deptId FK "null untuk direktur/Boss"
        string name
        string role "jabatan"
        string model "9router|gemini-*|claude-*"
        text prompt "persona / system prompt"
        boolean isDirector
        boolean isLead "manager / ketua tim"
        json look "style, warna, rambut, dll"
    }
    AGENT_MEMORY {
        string agentId FK "embedded"
        datetime t
        text text
    }
    CHAT_MESSAGE {
        string agentId FK "embedded"
        string from "boss|agent"
        text text
        datetime t
    }
    TASK {
        string id PK
        string title
        string targetType "all|division|dept|agent"
        string targetId FK "polimorfik"
        string status "briefing|meeting|in_progress|done|failed"
        boolean ai "dikerjakan AI atau simulasi"
        text result
        datetime created
    }
    SUBTASK {
        string id PK "embedded di TASK"
        string taskId FK
        string agentId FK
        string status "queued|working|done|failed"
        float progress
        text output
        json refs "dokumen & sumber data yang dibaca"
    }
    DOCUMENT {
        string id PK
        string kind "work|report|upload"
        string title
        string authorId FK
        string deptId FK
        string taskId FK
        text content "markdown"
        datetime t
    }
    ACTIVITY_LOG {
        datetime t
        string text
        string icon
    }
    FURNITURE {
        string id PK
        string type "plant|sofa|lamp|..."
        int x
        int y
    }
```

**Aturan bisnis penting**
- Hierarki perintah: **Boss → Direktur (DIVISION) → Lead (DEPARTMENT, `isLead`) → Anggota**.
- `TASK.targetType/targetId` polimorfik: `division` → `DIVISION.id`, `dept` → `DEPARTMENT.id`, `agent` → `AGENT.id`, `all` → seluruh kantor.
- Integrasi data berlaku **turun-temurun**: `DEPARTMENT.integration` (bila ada) menimpa `DIVISION.integration`; direktur memakai integrasi divisinya.

---

## 2. ERD lapisan integrasi

Saat ini satu divisi/departemen hanya bisa menunjuk **satu** connector (`integration` = string).
Karena tiap divisi nantinya bisa memakai **lebih dari satu aplikasi**, desain targetnya adalah
**registry connector + tabel penghubung (N:M)**:

```mermaid
erDiagram
    SOURCE_APP ||--o{ CONNECTOR : "punya 1..n connector"
    CONNECTOR ||--o{ CONNECTOR_DATASET : "mengekspos dataset"
    DIVISION ||--o{ INTEGRATION_BINDING : "memakai"
    DEPARTMENT ||--o{ INTEGRATION_BINDING : "memakai (override)"
    CONNECTOR ||--o{ INTEGRATION_BINDING : "dipasang di"
    CONNECTOR ||--o{ DATA_SNAPSHOT : "hasil tarik data"
    TASK ||--o{ DATA_SNAPSHOT : "konteks tugas"
    INTEGRATION_BINDING }o--o{ CONNECTOR_DATASET : "dataset terpilih"

    SOURCE_APP {
        string key PK "logistic|accounting|procurement|ekspedisi|minimarket|gudang|..."
        string name
        string repo "owner/repo GitHub"
        string ownerDivision "divisi utama"
        string storageType "supabase|turso|upstash|localStorage-sync|rest"
    }
    CONNECTOR {
        string key PK "dipakai di VO.integ.define()"
        string sourceAppKey FK
        string label
        string icon
        string endpoint "/api/{key} (Vercel Function, hanya baca)"
        string authMode "service-key|read-token|signed-snapshot"
        json envVars "nama env var yang dibutuhkan"
        int cacheTtlSec "default 600"
        boolean readOnly "selalu true"
    }
    CONNECTOR_DATASET {
        string connectorKey PK,FK
        string dataset PK "mis. job_orders, spj, journals"
        string description
        int maxRows "batas baris ke konteks AI"
    }
    INTEGRATION_BINDING {
        string id PK
        string scopeType "division|department"
        string scopeId FK
        string connectorKey FK
        int priority "urutan saat >1 connector"
        boolean enabled
    }
    DATA_SNAPSHOT {
        string id PK
        string connectorKey FK
        string taskId FK "null untuk chat"
        datetime fetchedAt
        json payload "ringkasan/agregat (bukan dump penuh)"
        text markdown "versi teks untuk prompt AI"
        string error
    }
```

**Cara menambah aplikasi baru untuk sebuah divisi (tanpa mengubah skema):**
1. Tambah 1 baris `SOURCE_APP` + `CONNECTOR` (kode: `lib/<app>.js`, `api/<app>.js`, `js/<app>.js` lewat `VO.integ.define`).
2. Tambah `INTEGRATION_BINDING` ke divisi/departemen yang membutuhkan (bisa lebih dari satu per divisi).
3. Agen otomatis menerima data semua binding aktifnya sebagai konteks tugas & chat.

> Migrasi dari model sekarang: nilai `DIVISION.integration` / `DEPARTMENT.integration` lama menjadi
> satu `INTEGRATION_BINDING` dengan `priority = 0`.

---

## 3. ERD aplikasi sumber

### 3a. Divisi Logistic — `logistic-management-system`

Sumber: `src/lib/types.ts`, `src/store/useStore.ts` · localStorage `lms-store-trial-v1`.

```mermaid
erDiagram
    CUSTOMER ||--o{ CUSTOMER_CONTRACT : "kontrak"
    CUSTOMER_CONTRACT ||--o{ CONTRACT_RATE : "tarif per tipe unit"
    UNIT_TYPE ||--o{ CONTRACT_RATE : ""
    CUSTOMER ||--o{ JOB_ORDER : "memesan"
    LOCATION ||--o{ JOB_ORDER : "asal"
    LOCATION ||--o{ JOB_ORDER : "tujuan"
    UNIT_TYPE ||--o{ JOB_ORDER : "jenis armada"
    JOB_ORDER ||--o{ SPJ : "qty unit = jumlah SPJ"
    UNIT ||--o{ SPJ : "ditugaskan"
    DRIVER ||--o{ SPJ : "ditugaskan"
    SPJ ||--o| SPJ_SETTLEMENT : "realisasi biaya"
    SPJ ||--o{ TRIP_EVENT : "riwayat status"
    SPJ ||--o{ PROCUREMENT_REQUEST : "kebutuhan unit/driver"
    UNIT_TYPE ||--o{ UNIT : ""
    LOCATION ||--o{ UNIT : "pool"
    LOCATION ||--o{ DRIVER : "pool"
    UNIT_TYPE ||--o{ LABOR_PRICE : ""
    UNIT_TYPE ||--o{ PROCUREMENT_REQUEST : ""
    CUSTOMER ||--o{ LMS_USER : "akun portal customer"
    DRIVER ||--o| LMS_USER : "akun driver"

    CUSTOMER {
        string id PK
        string number "CUST/0001"
        string code
        string name
        string npwp
        int topDays
        string pricingMode "PER_TRIP|PER_KM"
        boolean active
    }
    CUSTOMER_CONTRACT {
        string id PK
        string customerId FK
        string number
        date startDate
        date endDate
        string pricingMode
        float minKm
    }
    CONTRACT_RATE {
        string contractId FK "embedded"
        string unitTypeId FK
        float ratePerKm
        float ratePerTrip
    }
    LOCATION {
        string id PK
        string name
        string city
        float lat
        float lng
        boolean isPool
    }
    UNIT_TYPE {
        string id PK
        string name
        float capacityTon
        float fuelRatio
        float tollRatePerKm
        float depreciationPerKm
        float tariffPerKm
        float tariffPerTrip
        string licenseRequired "B1|B2"
    }
    UNIT {
        string id PK
        string plate
        string typeId FK
        string poolId FK
        string ownership "OWN|VENDOR"
        string status "AVAILABLE|ASSIGNED|ON_TRIP|MAINTENANCE|OFF"
        int odometer
    }
    DRIVER {
        string id PK
        string name
        string license "B1|B2"
        float wagePerKm
        string poolId FK
        string ownership
        string status
    }
    JOB_ORDER {
        string id PK
        string number "JO/0000001/X.2026"
        date joDate
        date pickupDate
        string customerId FK
        string originId FK
        string destinationId FK
        string unitTypeId FK
        string cargo
        float weightTon
        int qty
        float agreedRate
        string status "SUBMITTED|APPROVED|ACCEPTED|REJECTED|COMPLETED"
        string source "PORTAL|UPLOAD|INTERNAL"
    }
    SPJ {
        string id PK
        string number "SPJ/0000001-n/X.2026"
        string joId FK
        string unitId FK
        string driverId FK
        string status "DISPATCH..BERANGKAT..SETTLEMENT..SELESAI"
        json route "pool/origin/destination + km"
        json ujp "uang jalan: fuel, tol, parkir, makan"
        float tkbmEstimate
    }
    SPJ_SETTLEMENT {
        string spjId FK "embedded"
        float actualKm
        float fuelCost
        float tollCost
        float parkingCost
        float tkbmCost
        string approvedBy
        datetime approvedAt
    }
    TRIP_EVENT {
        string id PK "embedded"
        string spjId FK
        datetime at
        string status
        string actor
    }
    PROCUREMENT_REQUEST {
        string id PK
        string number "PR/..."
        string spjId FK
        string kind "UNIT|DRIVER"
        string unitTypeId FK
        string status "REQUESTED|FULFILLED|CANCELLED"
        string fulfilledResourceId FK "Unit atau Driver"
    }
    LABOR_PRICE {
        string id PK
        string unitTypeId FK
        float monthlyWage
    }
    LMS_USER {
        string id PK
        string username
        string role "Customer|Admin|Dispatcher|Driver|Procurement|Finance"
        string customerId FK
        string driverId FK
    }
```

### 3b. Divisi Accounting — `laporan-keuangan-app`

Sumber: `supabase/schema.sql` · Supabase Postgres (RLS: `user_id = auth.uid()`).

```mermaid
erDiagram
    AUTH_USERS ||--o{ ACCOUNTS : "pemilik (tenant)"
    AUTH_USERS ||--o{ JOURNALS : "pemilik"
    AUTH_USERS ||--o{ JOURNAL_ENTRIES : "pemilik"
    JOURNALS ||--|{ JOURNAL_ENTRIES : "baris jurnal (cascade)"
    ACCOUNTS ||--o{ JOURNAL_ENTRIES : "akun (restrict)"

    AUTH_USERS {
        uuid id PK
        string email
    }
    ACCOUNTS {
        uuid id PK
        uuid user_id FK
        string code "9 digit"
        string sub_code
        string name
        string sub_name
        string type "Asset|Liability|Equity|Revenue|Expense"
        string sub_type "Aset Lancar, Beban Operasional, ..."
        string normal_balance "Debit|Credit"
        timestamptz created_at
    }
    JOURNALS {
        uuid id PK
        uuid user_id FK
        date date
        string description
        string type "Standard|Adjustment|Elimination"
        string document_number UK "JU|JP|JE-YYYYMM-NNNN"
        timestamptz created_at
    }
    JOURNAL_ENTRIES {
        uuid id PK
        uuid user_id FK
        uuid journal_id FK
        uuid account_id FK
        decimal debit "numeric 18,2"
        decimal credit "numeric 18,2"
    }
```

Laporan (neraca, laba rugi, umur piutang/hutang) dihitung dari `journal_entries` — bukan tabel.

### 3c. Divisi Procurement — `procurement-management-system`

Sumber: `lib/types.ts`, `lib/ops.ts` · localStorage `procura.pms.v2`.

```mermaid
erDiagram
    VENDOR ||--o{ PURCHASE_ORDER : "pemasok"
    PURCHASE_REQUEST ||--o| PURCHASE_ORDER : "dijadikan PO"
    PURCHASE_REQUEST ||--|{ PR_ITEM : "barang diminta"
    PURCHASE_ORDER ||--|{ PO_ITEM : "barang dipesan"
    PURCHASE_ORDER ||--o| INVOICE : "ditagih"
    VENDOR ||--o{ INVOICE : ""
    INVOICE ||--o{ PMS_JOURNAL : "jurnal Pembelian"
    VENDOR ||--o{ PAYMENT_VOUCHER : "dibayar"
    PAYMENT_VOUCHER ||--o{ INVOICE : "melunasi 1..n invoice"
    PAYMENT_VOUCHER ||--o| PMS_JOURNAL : "jurnal Pembayaran"
    PMS_JOURNAL ||--|{ PMS_JOURNAL_LINE : "baris"
    COA_PMS ||--o{ PMS_JOURNAL_LINE : "kode akun"

    VENDOR {
        string id PK
        string code "VND-0001"
        string name
        string category
        string npwp
        int terms "hari pembayaran"
        string bank
        string account
        string rating "A|B|C"
        boolean active
    }
    PURCHASE_REQUEST {
        string id PK
        string no "PR/YYYY/0001"
        date date
        string requester
        string department
        string priority "Rendah|Normal|Tinggi"
        string stage "SUBMITTED|SUPERVISOR_APPROVED|APPROVED|REJECTED|PO_CREATED"
        string status "Open|Closed"
        string poId FK
    }
    PR_ITEM {
        string prId FK "embedded"
        string name
        float qty
        string unit
    }
    PURCHASE_ORDER {
        string id PK
        string no "PO/YYYY/0001"
        string prId FK
        string vendorId FK
        float discount
        float taxRate
        date deliveryDate
        string stage "PENDING..APPROVED..SENT..ACCEPTED..SHIPPED..RECEIVED..CLOSED"
        boolean received
        string invoiceId FK
    }
    PO_ITEM {
        string poId FK "embedded"
        string name
        float qty
        string unit
        float price
    }
    INVOICE {
        string id PK
        string no "INV/YYYY/0001"
        string vendorInvoiceNo
        string poId FK
        string vendorId FK
        date dueDate
        float dpp
        float tax
        float pph
        float total
        float payable
        string status "Posted|Paid"
        string voucherId FK
    }
    PAYMENT_VOUCHER {
        string id PK
        string no "JV/YYYY/0001"
        string vendorId FK
        float amount
        string method "Transfer|Cek/Giro|Tunai"
        string creditAccount FK
        string status "Draft|Checked|Approved|Paid|Cancelled"
        string journalId FK
    }
    PMS_JOURNAL {
        string id PK
        string no "JE/YYYY/0001"
        date date
        string type "Pembelian|Pembayaran"
        string invoiceId FK
        string voucherId FK
    }
    PMS_JOURNAL_LINE {
        string journalId FK "embedded"
        string account FK "mis. 2-1100 Hutang Usaha"
        float debit
        float credit
    }
    COA_PMS {
        string code PK "konstanta di lib/constants.ts"
        string name
    }
```

### 3d. Divisi Ekspedisi — `ekspedisi-app`

Sumber: `src/lib/types.ts`, `src/contexts/app-context.tsx` · localStorage `ekspedisi-app-state`.

```mermaid
erDiagram
    EXP_ORDER ||--o{ EXP_SPJ : "surat perintah jalan"
    EXP_ORDER ||--o{ EXP_SPK : "kerja vendor"
    EXP_ORDER ||--o{ EXP_SETTLEMENT : "biaya aktual"
    EXP_DRIVER ||--o{ EXP_SPJ : ""
    EXP_VEHICLE ||--o{ EXP_SPJ : ""
    EXP_SPJ ||--o{ EXP_SETTLEMENT : "realisasi (praktis 0..1)"
    DISTANCE_ENTRY |o--o{ EXP_SPJ : "rute kota (lookup)"

    EXP_ORDER {
        string id PK
        string orderNumber
        string customerName "teks bebas"
        string pickupAddress
        string deliveryAddress
        string cargoDescription
        float weight
        date requestedDate
        float price "pendapatan"
        string status "pending|confirmed|in_transit|delivered|cancelled"
    }
    EXP_DRIVER {
        string id PK
        string name
        string phone
        string licenseNumber
        date licenseExpiry
        string status "active|inactive"
    }
    EXP_VEHICLE {
        string id PK
        string plateNumber
        string type
        string brand
        int year
        float capacity
        date lastMaintenance
        string status "available|in_use|maintenance"
    }
    EXP_SPJ {
        string id PK
        string spjNumber
        string orderId FK
        string driverId FK
        string vehicleId FK
        string routeFrom
        string routeTo
        date departureDate
        date arrivalDate
        string status "draft|active|completed|cancelled"
    }
    EXP_SPK {
        string id PK
        string spkNumber
        string orderId FK
        string vendorName "teks bebas"
        string scopeOfWork
        float agreedCost
        string status
    }
    EXP_SETTLEMENT {
        string id PK
        string settlementNumber
        string orderId FK
        string spjId FK
        float fuelCost
        float tollCost
        float driverAllowance
        float totalActualCost
        float estimatedCost
        string status "draft|submitted|approved"
    }
    COST_STRUCTURE {
        string id PK
        string name
        float fuelCostPerKm
        float overheadPerKm
        float marginPercentage
    }
    DISTANCE_ENTRY {
        string from PK "statis"
        string to PK
        float distanceKm
        float estimatedHours
    }
```

`COST_STRUCTURE` berdiri sendiri (template tarif). Trip cost, trip revenue & laba rugi dihitung di halaman (bukan tabel).

---

## 4. Relasi lintas aplikasi

Relasi ini **konseptual** (belum ada FK nyata antar aplikasi). Inilah yang dipakai agen AI
untuk analisis lintas divisi — misalnya Direktur Keuangan membandingkan hutang dari Procurement
dengan jurnal di Accounting.

```mermaid
erDiagram
    DIVISION ||--o{ INTEGRATION_BINDING : "memakai connector"
    INTEGRATION_BINDING }o--|| CONNECTOR : ""
    CONNECTOR }o--|| SOURCE_APP : ""

    SOURCE_APP ||--o{ JOB_ORDER : "logistic"
    SOURCE_APP ||--o{ JOURNALS : "accounting"
    SOURCE_APP ||--o{ PURCHASE_ORDER : "procurement"
    SOURCE_APP ||--o{ EXP_ORDER : "ekspedisi"

    PROCUREMENT_REQUEST }o..o| PURCHASE_REQUEST : "LMS butuh unit/driver -> PR Procurement"
    PURCHASE_ORDER ||..o| INVOICE : ""
    PMS_JOURNAL }o..o| JOURNALS : "jurnal Pembelian/Pembayaran diposting ke Accounting"
    COA_PMS }o..o| ACCOUNTS : "pemetaan kode akun (1-1110 -> 9 digit)"
    SPJ_SETTLEMENT }o..o| JOURNALS : "biaya trip -> jurnal beban"
    EXP_SETTLEMENT }o..o| JOURNALS : "biaya trip ekspedisi -> jurnal beban"
    JOB_ORDER }o..o| EXP_ORDER : "order pengiriman dapat dialihkan ke ekspedisi"
    SPJ }o..o| EXP_SPJ : "nomor SPJ / plat sebagai kunci pencocokan"
    UNIT }o..o| EXP_VEHICLE : "plat nomor (plate = plateNumber)"
    DRIVER }o..o| EXP_DRIVER : "nama / no SIM"
```

Garis putus-putus (`..`) = **kunci pencocokan bisnis** (nomor dokumen, plat, kode akun, nama), bukan FK fisik.

| Dari | Ke | Kunci pencocokan | Kegunaan agen AI |
|---|---|---|---|
| Logistic `PROCUREMENT_REQUEST` | Procurement `PURCHASE_REQUEST` | nomor PR / jenis unit | Lead time pengadaan armada |
| Procurement `PMS_JOURNAL_LINE.account` | Accounting `ACCOUNTS.code` | tabel mapping kode akun | Rekonsiliasi hutang usaha & PPN |
| Logistic `SPJ_SETTLEMENT` | Accounting `JOURNALS` | nomor SPJ di deskripsi jurnal | Cek biaya trip sudah dijurnal |
| Ekspedisi `EXP_SETTLEMENT` | Accounting `JOURNALS` | nomor settlement | Margin per trip vs pencatatan |
| Logistic `UNIT` | Ekspedisi `EXP_VEHICLE` | plat nomor | Utilisasi armada gabungan |
| Logistic `JOB_ORDER` | Ekspedisi `EXP_ORDER` | customer + tanggal + rute | Order yang di-subkon-kan |

---

## 5. Catatan teknis integrasi

### Kesiapan sumber data

| Aplikasi | Bisa dibaca server Visual Office? | Yang perlu dilakukan |
|---|---|---|
| **Accounting** (Supabase) | **Ya** | Buat role/kunci **read-only** (role Postgres `SELECT`-only atau service key + filter `user_id`). Env: `ACCOUNTING_SUPABASE_URL`, `ACCOUNTING_SUPABASE_KEY`, `ACCOUNTING_USER_ID`. |
| **Logistic** (localStorage) | **Tidak** — data hanya ada di browser pengguna | Tambah backend/sinkronisasi (lihat opsi di bawah). |
| **Procurement** (localStorage) | **Tidak** | Sama; aplikasi ini sudah punya *Backup JSON* yang formatnya bisa dipakai sebagai payload sinkron. |
| **Ekspedisi** (localStorage) | **Tidak** | Sama. |

### Opsi agar aplikasi localStorage bisa dibaca (rekomendasi: A)

- **A. Snapshot sync ke Upstash (paling ringan).** Tiap aplikasi menambah satu fungsi kecil yang,
  setiap ada perubahan, mengirim state JSON-nya ke endpoint
  `POST /api/sync/<app>` → disimpan sebagai `snapshot:<app>:<tenant>` di Upstash. Connector Visual
  Office membaca snapshot itu (hanya baca). Tanpa mengubah struktur data aplikasi.
- **B. Pindah ke database** (Supabase/Turso) seperti Accounting & MiniMarket — paling rapi untuk
  multi-user, tapi butuh refactor penyimpanan tiap aplikasi.
- **C. Upload manual** file *Backup JSON* ke Gudang Dokumen Visual Office — cepat untuk demo, tidak real-time.

### Prinsip connector (sama dengan Gudang & MiniMarket)
- **Hanya baca**; server Vercel yang mengambil data, kunci tidak pernah dikirim ke browser.
- Data diringkas (agregat + baris terbaru, dibatasi `maxRows`) sebelum masuk prompt AI.
- Cache per tugas 10 menit (`DATA_SNAPSHOT`) agar hemat kuota & konsisten antar anggota tim.
- Setiap laporan agen mencantumkan sumber & waktu pengambilan data.
