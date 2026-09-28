# معماری

## Modular Monolith

همان‌طور که در طراحی اولیه آمده بود، نسخه‌ی اول **یک سرویس NestJS با ماژول‌های جدا** است، نه ۱۵ میکروسرویس. مرز ماژول‌ها طوری کشیده شده که بعداً بتوان Monitoring، Workerهای BullMQ یا Automation را بدون بازنویسی به process جدا منتقل کرد: ارتباط بین آن‌ها از قبل از طریق Redis (pub/sub، صف) است.

```
                     ┌────────────── Browser ──────────────┐
                     │ Next.js 15 · React Query · Socket.IO│
                     └──────────────────┬──────────────────┘
                                        │ HTTPS / WSS
                                   ┌────▼────┐
                                   │  Nginx  │  TLS, HSTS, /api → API, / → web
                                   └────┬────┘
            ┌───────────────────────────┼──────────────────────────────┐
            │                  NestJS API (apps/api)                   │
            │ ┌──────┐ ┌──────┐ ┌───────┐ ┌─────────┐ ┌─────────────┐  │
            │ │ auth │ │users │ │routers│ │ network │ │ monitoring  │  │
            │ └──────┘ └──────┘ └───────┘ └────┬────┘ │ poller·ws   │  │
            │ ┌──────┐ ┌──────────────┐        │      │ alerts·prom │  │
            │ │audit │ │ backups(Bull)│        │      └──────┬──────┘  │
            │ └──────┘ └──────┬───────┘        │             │         │
            │           ┌─────▼────────────────▼─────────────▼──────┐  │
            │           │    mikrotik: MikrotikService (pool)       │  │
            │           │ RouterOsClient → RouterAdapter            │  │
            │           │   REST │ API (8728/8729) │ SSH (/export)  │  │
            │           └──────────────────┬────────────────────────┘  │
            └───────────┬──────────────────┼─────────────────┬─────────┘
                        │                  │                 │
                  ┌─────▼─────┐      ┌─────▼─────┐     ┌─────▼──────┐
                  │PostgreSQL │      │ MikroTik  │     │   Redis    │
                  │ Prisma    │      │ #1 … #N   │     │ cache·pub/ │
                  └───────────┘      └───────────┘     │ sub·BullMQ │
                                                       └─────┬──────┘
                                                  Prometheus ◄── /api/metrics ──► Grafana
```

## ساختار پروژه

```
apps/
├── api/                        NestJS + Prisma
│   ├── prisma/                 schema.prisma (ERD), migrations, seed.ts
│   ├── scripts/                routeros-simulator.ts (توسعه بدون سخت‌افزار)
│   └── src/
│       ├── config/             env تایپ‌شده و اعتبارسنجی‌شده (fail fast)
│       ├── common/
│       │   ├── auth/           decoratorها و guardها (CSRF, Auth, Permissions)
│       │   ├── rbac/           کاتالوگ permission و نقش‌های پیش‌فرض
│       │   ├── crypto/         AES-256-GCM با نسخه‌ی کلید
│       │   ├── security/       IP allowlist
│       │   ├── validation/     validatorهای RouterOS (CIDR, port, MAC, …)
│       │   └── filters/        نگاشت خطای روتر/Prisma به HTTP
│       ├── auth/               login, session, TOTP 2FA
│       ├── users/              کاربران و نقش‌ها
│       ├── audit/              ثبت before/after و redaction
│       ├── mikrotik/           ★ لایه‌ی اتصال
│       │   ├── types.ts        RouterAdapter + allowlistها
│       │   ├── api/            پروتکل باینری RouterOS API (tagged, multiplexed)
│       │   ├── rest/           آداپتر REST v7
│       │   ├── ssh/            اجرای /export با host-key pinning
│       │   ├── routeros.client.ts   فاساد تایپ‌شده
│       │   └── mikrotik.service.ts  رمزگشایی credential، pool اتصال
│       ├── routers/            CRUD روتر و گروه (درختی)
│       ├── network/            interfaces, ip, routes, firewall, nat, address-list,
│       │                       dhcp, ppp, queues, logs, reboot, bulk deploy
│       ├── monitoring/         poller, alerts, Telegram, Socket.IO gateway, /metrics
│       └── backups/            BullMQ queue/worker, scheduler, diff
└── web/                        Next.js App Router + Tailwind + کامپوننت‌های shadcn-style
    └── src/
        ├── app/login           ورود + 2FA
        ├── app/(panel)/        dashboard, routers, routers/[id], groups, alerts,
        │                       audit, users, account
        ├── components/         app-shell, resource-tab/form (داده‌محور), time-chart, ui/*
        └── lib/                api client, auth hooks, live (WebSocket), resources
deploy/                         nginx, prometheus, grafana
docs/                           این مستندات
```

## جریان‌ها

### تغییر پیکربندی (مثلاً حذف قانون فایروال)
1. `DELETE /api/routers/:id/firewall/filter/*17` → guardها (IP، rate، CSRF، session، `firewall:write`).
2. `RosIdPipe` شناسه را بررسی می‌کند.
3. `NetworkService.remove` → `MikrotikService.withClient` (اتصال pooled؛ credential رمزگشایی می‌شود).
4. وضعیت فعلی آیتم خوانده می‌شود (before) → `remove` → ثبت `FIREWALL_FILTER_DELETE` با before و نتیجه.
5. خطای اتصال → pool باطل می‌شود و پاسخ `504`؛ رد شدن توسط RouterOS → `422` با پیام روتر.

### Real-time
```
setInterval(POLL_INTERVAL_MS) ─► Redis lock "poller" (فقط یک replica)
   └─► هر روتر (concurrency محدود): system/resource + interface + health + ppp/active
         ├─► محاسبه‌ی bps از delta شمارنده‌ها (reset شمارنده → 0)
         ├─► Redis SET nms:live:<id>  (TTL = 5 × interval)
         ├─► Redis PUBLISH nms:events {router.live}
         ├─► metric_samples (برای نمودار ۱ ساعته)
         └─► AlertsService: offline / auth / cpu (۳ poll پیاپی) / interface down
                └─► dedupe با fingerprint → Telegram + PUBLISH {alert.opened}
Gateway (هر replica) SUBSCRIBE nms:events ─► Socket.IO room ─► React Query cache
```

### Backup
`POST /routers/:id/backups` یک ردیف `PENDING` و یک job در BullMQ می‌سازد و فوراً `202` برمی‌گرداند. Worker با concurrency ۵ از طریق SSH `/export terse` می‌گیرد، sha256 و محتوا را ذخیره می‌کند؛ دو تلاش با backoff. زمان‌بندی روزانه با `upsertJobScheduler` (`BACKUP_CRON`). Diff خطوط timestamp هدر export را نادیده می‌گیرد.

### Bulk deploy با Dry Run
`POST /router-groups/:id/deploy {dryRun: true}` برای همه‌ی روترهای گروه و زیرگروه‌ها (همزمانی ۵) وضعیت فعلی را می‌خواند و برای هر روتر `create`، `skip` (وجود دارد) یا `error` (در دسترس نیست) برمی‌گرداند. فقط بعد از بررسی، اجرای واقعی با `dryRun: false`؛ هر روتر یک رکورد audit و کل عملیات یک `BULK_DEPLOY` دارد.

## مقیاس‌پذیری

| نیاز | راه |
|---|---|
| چند replica از API | poller و پاک‌سازی با Redis lock؛ WebSocket از طریق Redis pub/sub؛ BullMQ ذاتاً توزیع‌شده. فقط throttler را به Redis storage ببرید. |
| جدا کردن Monitoring/Workers | همان image با `DISABLE_POLLER=true` روی replicaهای API و یک process جدا فقط برای poller/worker. |
| صدها روتر | `POLL_CONCURRENCY` و `POLL_INTERVAL_MS`؛ برای هزاران روتر SNMP/Prometheus exporter اختصاصی. |
