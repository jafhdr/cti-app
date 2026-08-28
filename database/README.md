# PostgreSQL Native Setup (Windows)

CTI App MVP tidak menggunakan Docker. PostgreSQL dijalankan langsung di Windows.

## 1. Install PostgreSQL

Install PostgreSQL 16 (atau versi yang kompatibel dengan Prisma) menggunakan installer resmi PostgreSQL/EDB.

Saat instalasi, ingat password user `postgres`.

## 2. Buat database CTI

Buka pgAdmin Query Tool atau `psql`, lalu jalankan:

```sql
CREATE DATABASE cti;
```

Jika database `cti` sudah ada, langkah ini tidak perlu diulang.

## 3. Atur backend `.env`

Copy `backend/.env.example` menjadi `backend/.env` dan sesuaikan:

```env
DATABASE_URL="postgresql://postgres:POSTGRES_PASSWORD@localhost:5432/cti?schema=public"
```

Ganti `POSTGRES_PASSWORD` dengan password PostgreSQL Anda.

## 4. Test koneksi

Dari folder `backend`:

```powershell
npx prisma generate
npx prisma migrate dev --name init
npm run seed
```

Jika migration dan seed berhasil, database siap digunakan.
