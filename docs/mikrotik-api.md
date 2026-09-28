# نقشه‌ی API — پنل ↔ RouterOS

همه‌ی مسیرها زیر `/api` هستند. هر درخواست تغییردهنده به هدر `X-Requested-With: mikrotik-nms` نیاز دارد (CSRF) و در `audit_logs` با وضعیت قبل/بعد ثبت می‌شود.

## لایه‌ی اتصال

```
Controller (DTO معتبرسازی‌شده)
   ↓
NetworkService  ── audit (before/after)
   ↓
RouterOsClient   (متدهای تایپ‌شده: getSystemResource, move, unset, …)
   ↓
RouterAdapter    (print / get / add / set / remove / command)
   ├── RestRouterAdapter   RouterOS v7  https://<host>/rest/...
   ├── ApiRouterAdapter    RouterOS API 8728 / API-SSL 8729 (پیاده‌سازی بومی پروتکل)
   └── runSshCommand       فقط `/export terse` برای backup (host key pinning)
```

`RouterAdapter` فقط مسیرهای لیست سفید `MENU_PATHS` و فرمان‌های `ROS_COMMANDS` (`move`, `reboot`, `make-static`, `unset`) را قبول می‌کند؛ نام propertyها با `^[a-z0-9-]+$` و شناسه‌ها با `^\*[0-9A-F]+$` بررسی می‌شوند. هیچ endpointی برای «فرمان خام» وجود ندارد.

| عمل | REST (v7) | API (v6/v7) |
|---|---|---|
| print | `GET /rest/<menu>?.proplist=…&key=value` | `/<menu>/print` `=.proplist=…` `?key=value` |
| get | `GET /rest/<menu>/<id>` | `/<menu>/print` `?.id=<id>` |
| add | `PUT /rest/<menu>` | `/<menu>/add` `=k=v` → `!done =ret=<id>` |
| set | `PATCH /rest/<menu>/<id>` | `/<menu>/set` `=.id=<id>` `=k=v` |
| remove | `DELETE /rest/<menu>/<id>` | `/<menu>/remove` `=.id=<id>` |
| command | `POST /rest/<menu>/<cmd>` | `/<menu>/<cmd>` `=k=v` |

## Endpointهای پلتفرم

### احراز هویت و کاربران
| Method | Path | Permission |
|---|---|---|
| POST | `/auth/login` `{username,password,totp?}` | عمومی (rate-limit: ۱۰/دقیقه) |
| POST | `/auth/logout` | کاربر واردشده |
| GET | `/auth/me` | کاربر واردشده |
| POST | `/auth/password` | کاربر واردشده |
| POST | `/auth/2fa/setup` · `/auth/2fa/enable` · `/auth/2fa/disable` | کاربر واردشده |
| GET/POST/PATCH/DELETE | `/users`, `/users/:id` | `user:read` / `user:write` |
| GET | `/roles` | `user:read` |
| GET | `/audit-logs?routerId&userId&action&cursor&take` | `audit:read` |

### روترها و گروه‌ها
| Method | Path | Permission |
|---|---|---|
| GET | `/routers?groupId=` | `router:read` |
| POST | `/routers` (با `testConnection`) | `router:write` |
| GET/PATCH | `/routers/:id` | `router:read` / `router:write` |
| DELETE | `/routers/:id` | `router:delete` |
| POST | `/routers/:id/refresh` | `router:read` |
| POST | `/routers/:id/ssh-host-key/reset` | `router:write` |
| GET/POST/PATCH/DELETE | `/router-groups[/:id]` | `router:read` / `router:write` / `router:delete` |
| POST | `/router-groups/:id/deploy` `{kind, dryRun, payload}` | `firewall:write` یا `firewall:address-list` |

### منابع روتر (`/routers/:routerId/...`)
| Path | RouterOS menu | خواندن | نوشتن | عملیات |
|---|---|---|---|---|
| `/system` | `/system/resource`, `identity`, `routerboard`, `health` | `router:read` | — | GET |
| `/system/logs?limit&topic` | `/log` | `log:read` | — | GET |
| `/system/reboot` | `/system/reboot` | — | `system:reboot` | POST |
| `/interfaces[/:id]` | `/interface` | `interface:read` | `interface:write` | GET, PATCH (comment, mtu, disabled) |
| `/ip/addresses[/:id]` | `/ip/address` | `ip:read` | `ip:write` | CRUD |
| `/ip/routes[/:id]` | `/ip/route` | `ip:read` | `ip:write` | CRUD |
| `/firewall/filter[/:id]` + `/:id/move` | `/ip/firewall/filter` | `firewall:read` | `firewall:write` | CRUD + move |
| `/firewall/nat[/:id]` + `/:id/move` | `/ip/firewall/nat` | `firewall:read` | `firewall:write` | CRUD + move |
| `/firewall/address-list[/:id]?list=` | `/ip/firewall/address-list` | `firewall:read` | `firewall:write` **یا** `firewall:address-list` | CRUD |
| `/dhcp/servers`, `/dhcp/networks` | `/ip/dhcp-server[/network]` | `dhcp:read` | — | GET |
| `/dhcp/leases[/:id]` + `/:id/make-static` | `/ip/dhcp-server/lease` | `dhcp:read` | `dhcp:write` | CRUD + make-static |
| `/ppp/secrets[/:id]` | `/ppp/secret` (رمز در خروجی حذف می‌شود) | `ppp:read` | `ppp:write` | CRUD |
| `/ppp/profiles` | `/ppp/profile` | `ppp:read` | — | GET |
| `/ppp/active[/:id]` | `/ppp/active` | `ppp:read` | `ppp:write` | GET, DELETE (= disconnect) |
| `/queues/simple[/:id]` | `/queue/simple` | `queue:read` | `queue:write` | CRUD |
| `/backups` | SSH `/export terse` | `backup:read` | `backup:create` | GET, POST (صف BullMQ) |

در `PATCH` مقدار `null` یعنی **unset** (بازگشت به پیش‌فرض RouterOS)، مثلاً `{"srcAddress": null}`.

### کاربران شبکه (Clients) — مصرف، محدودسازی، مسدودسازی
| Method | Path | Permission |
|---|---|---|
| GET | `/routers/:id/clients` | `client:read` |
| GET | `/routers/:id/clients/usage?days=30` | `client:read` |
| GET | `/routers/:id/clients/usage/history?key=ip:192.168.88.10&days=30` | `client:read` |
| POST | `/routers/:id/clients/limit` `{address \| pppUser, download, upload, reconnect?}` | `client:write` |
| POST | `/routers/:id/clients/unlimit` `{address \| pppUser, reconnect?}` | `client:write` |
| POST | `/routers/:id/clients/block` `{address \| pppUser, reason?, duration?}` | `client:write` |
| POST | `/routers/:id/clients/unblock` `{address \| pppUser}` | `client:write` |
| POST | `/routers/:id/clients/track` `{addresses: [...]}` | `client:write` |

**فهرست کاربران** از ادغام این جدول‌ها ساخته می‌شود: `/ip/dhcp-server/lease`، `/ip/arp` (فقط روی interfaceهایی که DHCP server دارند، تا gateway بالادستی کاربر حساب نشود)، `/ppp/active` + `/ppp/secret`، `/ip/hotspot/active`، `/queue/simple` و address-list `nms-blocked`. کاربران PPP با نام کاربری کلید می‌خورند (IP هر session عوض می‌شود)، بقیه با IP.

**مصرف لحظه‌ای:**
- کلاینت IP: فیلدهای `rate` و `bytes` صف ساده‌ای که فقط همان IP را هدف گرفته (`upload/download`). دستگاه بدون صف نرخ ندارد؛ دکمه‌ی «Start measuring usage» برایش صف بدون محدودیت `nms-<ip>` با `0/0` می‌سازد.
- کلاینت PPP: interface پویای `<pppoe-user>` (rx = آپلود کاربر، tx = دانلود) یا صف پویای PPP اگر profile محدودیت داشته باشد.

**مصرف روزانه:** poller در هر دور شمارنده‌های بایت همین منابع را می‌خواند و **اختلاف** را در `client_usage_daily` جمع می‌زند (روز UTC). شمارنده‌ای که عقب برود (reboot، اتصال دوباره‌ی PPP، ساخت دوباره‌ی صف) reset حساب می‌شود و ترافیک از دست نمی‌رود.

**محدودسازی:**
| نوع کاربر | کاری که روی روتر انجام می‌شود |
|---|---|
| IP (DHCP/hotspot/static) | اگر صفی فقط برای این IP هست، `max-limit` آن تنظیم می‌شود؛ وگرنه صف `nms-<ip>` با `place-before` بالاتر از همه‌ی صف‌های ثابت ساخته می‌شود (RouterOS اولین صف منطبق را اعمال می‌کند، پس صف یک subnet کلی بالاتر از آن اثری ندارد). فوری. |
| PPP | `rate-limit` روی PPP secret. RouterOS آن را هنگام **اتصال بعدی** اعمال می‌کند؛ با `reconnect: true` session قطع می‌شود تا فوراً اعمال شود. |

حذف محدودیت، صف را حذف نمی‌کند و `max-limit=0/0` می‌گذارد تا شمارش مصرف ادامه پیدا کند.

**مسدودسازی:**
| نوع کاربر | کاری که روی روتر انجام می‌شود |
|---|---|
| IP | بار اول دو قانون `forward drop` با `src-address-list=nms-blocked` و `dst-address-list=nms-blocked` (کامنت `nms:block-src/dst`) بالای فیلتر ساخته می‌شود. سپس IP به `nms-blocked` اضافه می‌شود (با `timeout` اختیاری مثل `1h`) و اتصال‌های باز آن از `/ip/firewall/connection` حذف می‌شوند؛ چون اتصال‌های fasttrack شده از فایروال عبور نمی‌کنند و بدون این کار دانلود جاری ادامه پیدا می‌کرد. |
| PPP | PPP secret غیرفعال و session قطع می‌شود؛ تا رفع مسدودیت نمی‌تواند وصل شود. |

محدودیت‌ها و نکات:
- کاربر IP می‌تواند IP خود را دستی عوض کند. برای شبکه‌های حساس، lease را static کنید و روی interface حالت `arp=reply-only` بگذارید.
- کاربران PPP که از RADIUS احراز می‌شوند secret محلی ندارند و باید روی RADIUS مدیریت شوند (API پیام روشن برمی‌گرداند).
- دستگاه مسدود هنوز به خود روتر (DNS، Winbox) دسترسی دارد؛ فقط عبور از روتر (اینترنت) بسته است.

### مانیتورینگ و بکاپ
| Method | Path | Permission |
|---|---|---|
| GET | `/monitoring/overview` | `monitoring:read` |
| GET | `/monitoring/routers/:id/live` · `/history?hours=` | `monitoring:read` |
| GET | `/alerts?state=` · POST `/alerts/:id/ack` | `alert:read` / `alert:ack` |
| POST | `/backups/run-all` | `backup:create` |
| GET | `/backups/:id` · `/backups/:id/diff?from=` | `backup:read` |
| GET | `/metrics` (Bearer `METRICS_TOKEN`) | Prometheus |
| WS | `/api/socket.io` — رویدادهای `router.live`, `alert.opened`, `alert.resolved` | cookie نشست |

## نمونه

```http
POST /api/routers/5b2…/firewall/filter
X-Requested-With: mikrotik-nms
Content-Type: application/json

{ "chain": "input", "action": "drop", "protocol": "tcp", "dstPort": "22",
  "srcAddress": "10.10.10.0/24", "comment": "block ssh", "placeBefore": "*2" }
```

→ Backend این را به `PUT /rest/ip/firewall/filter` با بدنه‌ی
`{"chain":"input","action":"drop","protocol":"tcp","dst-port":"22","src-address":"10.10.10.0/24","comment":"block ssh","place-before":"*2"}`
(یا جملات API معادل) تبدیل می‌کند. فیلد ناشناخته (`"command": "/system reboot"`) با 400 رد می‌شود.

خطاهای روتر به HTTP نگاشت می‌شوند: روتر در دسترس نیست → `504 ROUTER_UNREACHABLE`، رمز رد شد → `502 ROUTER_AUTH_FAILED`، RouterOS دستور را رد کرد → `422 ROUTER_REJECTED` همراه پیام خود RouterOS.
