# MikroTik Network Management Platform

پنل مدیریت شبکه برای روترهای MikroTik (RouterOS v6/v7): مدیریت چند روتر، مانیتورینگ لحظه‌ای، هشدار، بکاپ و diff پیکربندی، عملیات گروهی با Dry Run، RBAC و Audit Log کامل.

**Stack:** NestJS 11 · Prisma 6 / PostgreSQL 16 · Redis + BullMQ · Socket.IO · Next.js 15 · Tailwind + کامپوننت‌های shadcn/ui · Prometheus/Grafana · Docker Compose + Nginx

| سند | محتوا |
|---|---|
| [docs/architecture.md](docs/architecture.md) | معماری Modular Monolith، ساختار پروژه، جریان‌ها |
| [docs/erd.md](docs/erd.md) | ERD دیتابیس و دلیل تصمیم‌ها |
| [docs/mikrotik-api.md](docs/mikrotik-api.md) | لایه‌ی اتصال RouterOS و لیست کامل APIها |
| [docs/security.md](docs/security.md) | معماری امنیتی، ماتریس RBAC، آماده‌سازی RouterOS |

## وضعیت قابلیت‌ها

**Phase 1 — هسته ✅**
ورود + 2FA (TOTP) · کاربران و ۵ نقش سیستمی · مدیریت روتر (REST v7 / API 8728-8729 / TLS) · Interface · IP Address · Route · DHCP (server, lease, make-static) · Firewall filter/NAT (با ترتیب و move) · Address list · PPP (secret, active, disconnect) · Simple queue · Log · Reboot · Backup

**کاربران شبکه و مصرف اینترنت ✅**
فهرست همه‌ی دستگاه‌ها و کاربران (DHCP، PPP، Hotspot، IP ثابت) مرتب بر اساس بیشترین دانلود لحظه‌ای · مصرف امروز و گزارش ۱/۷/۳۰/۹۰ روزه برای هر کاربر · **محدود کردن سرعت** با یک کلیک (صف ساده یا rate-limit برای PPP) · **مسدود کردن** موقت یا دائم (address-list + قطع اتصال‌های باز، یا غیرفعال کردن حساب PPP) · ثبت همه در Audit Log — جزئیات در [docs/mikrotik-api.md](docs/mikrotik-api.md#کاربران-شبکه-clients--مصرف-محدودسازی-مسدودسازی)

**Phase 2 — مانیتورینگ ✅**
CPU / RAM / دما / uptime / ترافیک هر interface / کاربران PPP فعال · WebSocket لحظه‌ای · هشدار (offline، رمز رد شده، CPU بالا، قطع لینک) با dedupe · Telegram · `/api/metrics` برای Prometheus + Grafana

**Phase 3 — اتوماسیون 🟡 (بخشی)**
✅ Router Groups درختی · ✅ Bulk deploy (قانون فایروال / address-list) با Dry Run · ✅ Auto backup زمان‌بندی‌شده · ✅ Config diff
⬜ موتور Automation (جدول `automation_rules` آماده است) · ⬜ Incident management · ⬜ Syslog → Loki · ⬜ ایمیل/SMS · ⬜ Restore

## شروع سریع (توسعه، بدون سخت‌افزار)

پیش‌نیاز: Node.js 20+، PostgreSQL 16، Redis 7.

```bash
npm install
cp .env.example apps/api/.env      # مقادیر زیر را پر کنید
#   DATABASE_URL=postgresql://nms:nms@localhost:5432/nms
#   REDIS_URL=redis://localhost:6379
#   JWT_SECRET=$(openssl rand -base64 48)
#   CREDENTIALS_KEY_V1=$(openssl rand -base64 32)
#   CORS_ORIGINS=http://localhost:3000

cd apps/api
set -a; . ./.env; set +a
npx prisma migrate deploy
ADMIN_USERNAME=admin ADMIN_PASSWORD='ChangeMe-Now-2026' npx ts-node prisma/seed.ts

npm run simulator &                # شبیه‌ساز RouterOS REST روی :8080 (admin/admin)
npm run start:dev                  # API روی :4000

# ترمینال دیگر
cd apps/web
NEXT_PUBLIC_API_ORIGIN=http://localhost:4000 npm run dev    # پنل روی :3000
```

وارد `http://localhost:3000` شوید و روتری با host `127.0.0.1`، پورت `8080`، اتصال REST، TLS خاموش و کاربر `admin/admin` اضافه کنید.

## استقرار (Docker Compose)

```bash
cp .env.example .env                           # همه‌ی secretها را پر کنید
echo -n "<METRICS_TOKEN>" > deploy/prometheus/metrics_token
# گواهی TLS در deploy/nginx/certs/{fullchain.pem,privkey.pem}
docker compose up -d --build
docker compose exec -e ADMIN_PASSWORD='<strong>' api npx ts-node prisma/seed.ts
docker compose --profile monitoring up -d      # Prometheus + Grafana در /grafana/
```

مایگریشن‌ها هنگام شروع کانتینر API به‌طور خودکار اجرا می‌شوند. فقط Nginx پورت عمومی (80/443) دارد.

قبل از افزودن روترهای واقعی، بخش «آماده‌سازی RouterOS» در [docs/security.md](docs/security.md) را اجرا کنید: کاربر اختصاصی با policy محدود، محدود به IP سرور، و سرویس‌های `www-ssl` / `api-ssl` با گواهی.

## تست

```bash
npm test                            # تست‌های واحد API (Jest)
npm run lint                        # typecheck API و web
```

تست‌ها شامل: رمزگذاری/رمزگشایی و ضد-دستکاری credential، بردارهای RFC برای TOTP، کدگذاری پروتکل RouterOS API، کلاینت API در برابر یک روتر جعلی (login، trap، multiplex، رد مسیر/فرمان/شناسه‌ی غیرمجاز)، SSH export با host-key pinning، validatorها، IP allowlist، config diff.
