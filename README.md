# CTI App — Login & Dashboard MVP (Native Windows)

Versi ini **tidak menggunakan Docker, Docker Desktop, Redis, atau WSL** untuk menjalankan aplikasi.

## Arsitektur MVP

```text
Browser
  |
  v
Next.js Frontend :3000
  |
  | HTTP + HttpOnly Cookie
  v
Node.js / NestJS Backend :3001
  |
  | Prisma
  v
PostgreSQL Native :5432
```

## Scope hari ini

1. Login
2. Logout
3. Refresh session
4. Protected dashboard
5. Dashboard CTI awal
6. Tenant context dasar
7. Role dasar
8. Swagger API

Redis dan Docker sengaja tidak digunakan pada MVP Login + Dashboard agar development lebih ringan dan sesuai environment Windows saat ini.

## Prasyarat

- Windows 10/11
- Node.js 20 LTS atau lebih baru
- npm
- PostgreSQL 16 atau versi kompatibel Prisma
- Tidak perlu Docker Desktop
- Tidak perlu WSL

## 1. Setup PostgreSQL

Lihat `database/README.md`.

Buat database:

```sql
CREATE DATABASE cti;
```

## 2. Setup Backend

Buka PowerShell:

```powershell
cd "C:\Users\AN515 57\Downloads\cti app\backend"
npm install
copy .env.example .env
```

Edit `.env` dan masukkan password PostgreSQL Anda:

```env
DATABASE_URL="postgresql://postgres:POSTGRES_PASSWORD@localhost:5432/cti?schema=public"
```

Kemudian:

```powershell
npx prisma generate
npx prisma migrate dev --name init
npm run seed
npm run start:dev
```

Backend: http://localhost:3001

Swagger: http://localhost:3001/docs

Akun demo:

- Email: `admin@cti.local`
- Password: `Admin123!`

## 3. Setup Frontend

Buka PowerShell baru:

```powershell
cd "C:\Users\AN515 57\Downloads\cti app\frontend"
npm install
copy .env.example .env.local
npm run dev
```

Frontend: http://localhost:3000

## 4. Test

1. Buka http://localhost:3000
2. Login dengan akun demo.
3. Pastikan diarahkan ke `/dashboard`.
4. Pastikan tenant dan role tampil.
5. Logout.
6. Coba buka `/dashboard` lagi; harus diarahkan kembali ke Login.
7. Buka http://localhost:3001/docs untuk test API.

## Troubleshooting

### `P1001 Can't reach database`

Pastikan PostgreSQL service sedang running dan port `5432` tersedia. Periksa `DATABASE_URL` di `backend/.env`.

### `password authentication failed`

Password di `DATABASE_URL` tidak sama dengan password user PostgreSQL.

### Port 5432 sudah digunakan

Cari proses yang menggunakan port 5432 atau gunakan port PostgreSQL yang sesuai dan ubah `DATABASE_URL`.

### Frontend tidak bisa memanggil backend

Pastikan backend berjalan di `http://localhost:3001` dan `frontend/.env.local` berisi:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Catatan produksi

JWT secret, password database, cookie settings, dan CORS harus diperketat sebelum deployment production.
