# ERD دیتابیس

منبع حقیقت: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma) — مایگریشن اولیه در `apps/api/prisma/migrations/`.

```mermaid
erDiagram
    USER }o--|| ROLE : "has"
    ROLE ||--o{ ROLE_PERMISSION : ""
    PERMISSION ||--o{ ROLE_PERMISSION : ""
    USER ||--o{ SESSION : "logs in"
    USER ||--o{ AUDIT_LOG : "performs"
    USER ||--o{ BACKUP : "requests"

    ROUTER_GROUP ||--o{ ROUTER_GROUP : "parent of"
    ROUTER_GROUP ||--o{ ROUTER : "contains"
    ROUTER ||--|| ROUTER_CREDENTIAL : "authenticates with"
    ROUTER ||--o{ BACKUP : ""
    ROUTER ||--o{ AUDIT_LOG : "target of"
    ROUTER ||--o{ ALERT : ""
    ROUTER ||--o{ METRIC_SAMPLE : ""

    USER {
        uuid id PK
        string username UK
        string passwordHash "argon2id"
        string totpSecretEnc "AES-256-GCM"
        bool totpEnabled
        int failedLogins
        datetime lockedUntil
        uuid roleId FK
    }
    ROLE {
        uuid id PK
        string name UK "super_admin, network_admin, operator, monitoring, read_only"
        bool isSystem
    }
    PERMISSION {
        uuid id PK
        string key UK "e.g. firewall:write"
    }
    SESSION {
        uuid id PK
        uuid userId FK
        datetime expiresAt
        datetime revokedAt
        string ip
    }
    ROUTER_GROUP {
        uuid id PK
        string name UK
        uuid parentId FK
    }
    ROUTER {
        uuid id PK
        string name UK
        string host
        int port
        enum connectionType "REST | API"
        bool useTls
        bool verifyTls
        int sshPort
        string sshHostKeySha256 "TOFU pin"
        enum status "UNKNOWN ONLINE OFFLINE AUTH_FAILED"
        string identity
        string version
        uuid groupId FK
    }
    ROUTER_CREDENTIAL {
        uuid routerId PK
        string username
        string passwordEnc "v1:iv:tag:ciphertext"
        int keyVersion
    }
    BACKUP {
        uuid id PK
        uuid routerId FK
        enum type "EXPORT | BINARY"
        enum status "PENDING RUNNING SUCCESS FAILED"
        text content "/export terse"
        string sha256
    }
    AUDIT_LOG {
        uuid id PK
        uuid userId FK
        string username
        string action "FIREWALL_FILTER_DELETE ..."
        uuid routerId FK
        string targetType
        string targetId "*1A"
        json before
        json after
        enum result "SUCCESS FAILURE DENIED"
        string ip
        datetime createdAt
    }
    ALERT {
        uuid id PK
        uuid routerId FK
        string type "router.offline, cpu.high, interface.down"
        enum severity
        enum state "OPEN ACKNOWLEDGED RESOLVED"
        string fingerprint "dedupe key"
    }
    METRIC_SAMPLE {
        bigint id PK
        uuid routerId FK
        int cpuLoad
        bigint memUsed
        bigint rxBps
        bigint txBps
        datetime createdAt
    }
    AUTOMATION_RULE {
        uuid id PK
        json trigger
        json condition
        json actions
    }
```

## تصمیم‌های طراحی

| تصمیم | چرا |
|---|---|
| `router_credentials` جدول جدا | رمز هیچ‌وقت همراه یک `SELECT` معمولی روی `routers` بیرون نمی‌آید. سرویس‌ها فقط `username` را انتخاب می‌کنند. |
| رمز با AAD = `router:<id>` رمزنگاری می‌شود | کپی کردن ciphertext یک روتر روی روتر دیگر باعث شکست رمزگشایی می‌شود. |
| `keyVersion` | چرخش کلید بدون downtime (جزئیات در [security.md](security.md)). |
| جدول `sessions` در کنار JWT | JWT امضا را تضمین می‌کند، ردیف session امکان باطل‌کردن فوری (logout، قفل، تغییر نقش) را می‌دهد. |
| `audit_logs.username` denormalized | لاگ حتی بعد از حذف کاربر معنادار می‌ماند (`userId` → `SET NULL`). |
| `alerts.fingerprint` | جلوگیری از هشدار تکراری: فقط یک هشدار باز برای هر (روتر، نوع، موضوع). |
| `metric_samples` با retention کوتاه | فقط برای نمودارهای داشبورد (پیش‌فرض ۲۴ ساعت). تاریخچه‌ی بلندمدت در Prometheus. |
| جداول firewall/nat/route **ذخیره نمی‌شوند** | منبع حقیقت پیکربندی خود روتر است؛ کپی در DB فوراً کهنه می‌شود. تاریخچه‌ی پیکربندی با backup/diff و تاریخچه‌ی تغییرات با audit log پوشش داده می‌شود. |
