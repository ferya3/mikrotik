# معماری امنیتی

این سیستم کلید کل شبکه را در دست دارد؛ پس فرض طراحی این است که **پنل هدف حمله است**. هر کنترل زیر در backend اعمال می‌شود — UI فقط دکمه‌ها را پنهان می‌کند.

## لایه‌ها

```
Internet ─► Nginx (TLS 1.2/1.3, HSTS, XFF overwrite, /api/metrics مسدود)
              │
              ▼
          API guards (به ترتیب):
            1. IP allowlist        ADMIN_IP_ALLOWLIST (HTTP و WebSocket)
            2. Rate limit          ۳۰۰/دقیقه عمومی، ۱۰/دقیقه login، ۵/دقیقه 2FA و تغییر رمز
            3. CSRF                SameSite=Strict + هدر اجباری X-Requested-With
            4. Authentication      JWT (HS256) در cookie httpOnly + ردیف session قابل ابطال
            5. Authorization       RBAC — deny by default
            6. Validation          DTO با whitelist + forbidNonWhitelisted
              │
              ▼
          Connector allowlists    مسیر منو، فرمان، نام property، شناسه‌ی RouterOS
              │
              ▼
          RouterOS (کاربر اختصاصی، TLS، محدود به IP سرور)
```

## احراز هویت

| کنترل | پیاده‌سازی |
|---|---|
| هش رمز | argon2id (19 MiB, t=2) — `auth.service.ts` |
| سیاست رمز | ۱۲–۱۲۸ کاراکتر، حروف بزرگ و کوچک و عدد |
| قفل حساب | ۵ تلاش ناموفق → ۱۵ دقیقه قفل |
| شمارش کاربر | کاربر ناموجود هم یک argon2 verify انجام می‌دهد (زمان پاسخ یکسان) و پیام خطا یکسان است |
| 2FA | TOTP (RFC 6238) با پیاده‌سازی داخلی و تست با بردارهای RFC؛ secret رمزنگاری‌شده؛ جلوگیری از replay همان کد |
| نشست | JWT امضاشده + جدول `sessions`؛ logout، تغییر رمز، تغییر نقش، غیرفعال‌سازی و reset 2FA نشست‌ها را باطل می‌کنند |
| Cookie | `httpOnly`, `Secure` (در production)، `SameSite=Strict`؛ JavaScript هیچ‌وقت توکن را نمی‌بیند |
| WebSocket | همان cookie؛ اتصال بدون نشست معتبر فوراً قطع می‌شود؛ room بر اساس permission |

## RBAC

Permissionها در [`permissions.ts`](../apps/api/src/common/rbac/permissions.ts) تعریف و با seed همگام می‌شوند. `PermissionsGuard` برای endpointی که policy ندارد **403** برمی‌گرداند (deny by default).

| قابلیت | Super Admin | Network Admin | Operator | Monitoring | Read Only |
|---|:-:|:-:|:-:|:-:|:-:|
| مشاهده‌ی روتر و پیکربندی | ✓ | ✓ | ✓ | فقط روتر/interface | ✓ |
| تغییر IP / Route / Interface | ✓ | ✓ | ✓ | ✗ | ✗ |
| Firewall filter / NAT | ✓ | ✓ | ✗ | ✗ | ✗ |
| Address list (فایروال محدود) | ✓ | ✓ | ✓ | ✗ | ✗ |
| DHCP / PPP / Queue | ✓ | ✓ | ✓ | ✗ | ✗ |
| افزودن/ویرایش روتر | ✓ | ✓ | ✗ | ✗ | ✗ |
| حذف روتر | ✓ | ✓ | ✗ | ✗ | ✗ |
| Reboot | ✓ | ✓ | ✗ | ✗ | ✗ |
| Backup | ✓ | ✓ | ✓ | ✗ | ✗ |
| Audit log | ✓ | ✓ | ✗ | ✗ | ✗ |
| مدیریت کاربران | ✓ | فقط مشاهده | ✗ | ✗ | ✗ |
| تنظیمات سیستم | ✓ | ✗ | ✗ | ✗ | ✗ |

محافظ‌های اضافه: کاربر نمی‌تواند خودش را حذف/غیرفعال کند یا نقش خودش را تغییر دهد؛ آخرین Super Admin فعال قابل حذف نیست.

## مدیریت Credential روترها

- رمز روتر با **AES-256-GCM** رمزنگاری می‌شود: `v<keyVersion>:<iv>:<tag>:<ciphertext>` با AAD = `router:<id>`.
- کلید (`CREDENTIALS_KEY_V1`) فقط در environment / secret manager است، نه در DB.
- رمز فقط هنگام اتصال رمزگشایی می‌شود و هیچ API ای آن را برنمی‌گرداند؛ در audit به `***` یا `(rotated)` تبدیل می‌شود.
- رمز PPP secretها هم در پاسخ‌های API حذف می‌شود.

**چرخش کلید:** `CREDENTIALS_KEY_V2` را اضافه کنید → `CREDENTIALS_ACTIVE_KEY_VERSION=2` → رمز روترها را دوباره ذخیره کنید (نسخه‌ی ۱ همچنان قابل خواندن است) → وقتی هیچ `keyVersion=1` نماند، V1 را حذف کنید.

## جلوگیری از Command Injection

1. **هیچ endpoint فرمان خامی وجود ندارد.** کلاینت ساختار می‌فرستد (`chain`, `action`, `dstPort`…)، backend درخواست را می‌سازد.
2. DTOها فقط فیلدهای اعلام‌شده را قبول می‌کنند (`forbidNonWhitelisted`) و هر مقدار با validator اختصاصی بررسی می‌شود (CIDR، پورت، MAC، نام، …).
3. مقادیر هرگز در متن CLI جاسازی نمی‌شوند: در API هر کلمه length-prefixed است و در REST بدنه JSON است — یک `\n/system reboot` داخل comment فقط یک comment است (تست: `protocol.spec.ts`).
4. آداپتر فقط مسیرهای `MENU_PATHS`، فرمان‌های `ROS_COMMANDS`، نام propertyهای `[a-z0-9-]` و شناسه‌های `*HEX` را می‌پذیرد (تست: `api-client.spec.ts`).
5. SSH فقط یک فرمان ثابت اجرا می‌کند: `/export terse`.

## اتصال امن به روتر

- **TLS** برای REST (`www-ssl`) و API-SSL (`8729`). گزینه‌ی `verifyTls` برای وقتی CA خودتان را روی روترها نصب کرده‌اید.
- **SSH host key pinning (TOFU):** اولین اتصال fingerprint را ذخیره می‌کند؛ عدم تطابق بعدی اتصال را رد می‌کند (ریست فقط با `router:write` و ثبت در audit).
- تغییر host/port کلید ثبت‌شده را پاک می‌کند (دستگاه جدید).

### آماده‌سازی RouterOS (پیشنهادی)

```routeros
# کاربر و گروه اختصاصی — نه admin
/user group add name=nms policy=read,write,api,rest-api,ssh,reboot,!local,!telnet,!ftp,!winbox,!web,!password,!policy,!sensitive,!sniff,!test,!romon
/user add name=nms-api group=nms password="<strong-random>" address=<NMS_SERVER_IP>/32

# گواهی و سرویس‌های رمزنگاری‌شده
/certificate add name=nms-ca common-name=nms-ca key-usage=key-cert-sign,crl-sign
/certificate sign nms-ca
/certificate add name=router-tls common-name=<ROUTER_IP>
/certificate sign router-tls ca=nms-ca
/ip service set www-ssl certificate=router-tls disabled=no address=<NMS_SERVER_IP>/32
/ip service set api-ssl certificate=router-tls address=<NMS_SERVER_IP>/32
/ip service set ssh address=<NMS_SERVER_IP>/32,<ADMIN_NET>
/ip service disable telnet,ftp,www,api
```

## Audit

هر تغییر (موفق یا ناموفق) با کاربر، IP، روتر، هدف، **وضعیت قبل و بعد** و خطا ثبت می‌شود؛ کلیدهایی شبیه password/secret/token/key به‌صورت بازگشتی `***` می‌شوند. ورود ناموفق هم ثبت می‌شود.

## هدرها و زیرساخت

Helmet روی API، هدرهای امنیتی روی Next.js و Nginx (HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy)، فقط Nginx پورت عمومی دارد، Postgres/Redis با رمز و فقط روی شبکه‌ی داخلی Docker، `/api/metrics` از بیرون مسدود و با Bearer token محافظت‌شده، کانتینرها با کاربر غیر root.

## کارهای باقی‌مانده

- ذخیره‌ی شمارنده‌ی rate-limit در Redis وقتی چند replica از API اجرا می‌شود (فعلاً in-memory برای هر instance).
- اتصال به Vault / KMS به‌جای کلید env.
- WebAuthn / کلید سخت‌افزاری به‌عنوان فاکتور دوم.
- تأیید دو-نفره (four-eyes) برای عملیات bulk روی گروه‌های بزرگ.
