import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { AuditResult } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsIn, IsObject, validate } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { AuthUser, CurrentUser, ReqMeta, RequestMeta, RequireAnyPermission } from '../common/auth/decorators';
import { PERMISSIONS as P, Permission } from '../common/rbac/permissions';
import { MikrotikService } from '../mikrotik/mikrotik.service';
import { RoutersService } from '../routers/routers.service';
import { CreateAddressListEntryDto, CreateFilterRuleDto } from './network.dto';
import { NetworkService } from './network.service';
import { RESOURCES, ResourceSpec } from './resources';
import { toRosProps } from './ros-props';

const DEPLOYABLE = {
  'firewall.filter': { spec: RESOURCES.firewallFilter, dto: CreateFilterRuleDto, perms: [P.FIREWALL_WRITE] },
  'firewall.address-list': {
    spec: RESOURCES.addressList,
    dto: CreateAddressListEntryDto,
    perms: [P.FIREWALL_WRITE, P.FIREWALL_ADDRESS_LIST],
  },
} satisfies Record<string, { spec: ResourceSpec; dto: new () => object; perms: Permission[] }>;

type DeployKind = keyof typeof DEPLOYABLE;

export class DeployDto {
  @IsIn(Object.keys(DEPLOYABLE)) kind: DeployKind;
  /** Default true: nothing is changed until the operator reviews the plan and re-submits with dryRun=false. */
  @IsBoolean() dryRun = true;
  @IsObject() payload: Record<string, unknown>;
}

export interface DeployPlanItem {
  routerId: string;
  routerName: string;
  action: 'create' | 'skip' | 'error';
  reason?: string;
  result?: 'created' | 'failed';
  id?: string;
  error?: string;
}

const CONCURRENCY = 5;

/** RouterOS prints booleans as true/false but accepts yes/no. */
const norm = (v: string | undefined) => (v === 'yes' ? 'true' : v === 'no' ? 'false' : v);

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * Deploys one configuration item to every router in a group (including sub-groups).
 * Always plan first (dry run): the plan shows per router whether the item would be created,
 * is already present, or the router is unreachable.
 */
@Injectable()
export class BulkService {
  constructor(
    private readonly routers: RoutersService,
    private readonly mikrotik: MikrotikService,
    private readonly net: NetworkService,
    private readonly audit: AuditService,
  ) {}

  async deploy(groupId: string, dto: DeployDto, user: AuthUser, meta: RequestMeta) {
    const def = DEPLOYABLE[dto.kind];
    if (!def.perms.some((p) => user.permissions.has(p))) throw new ForbiddenException();

    const item: object = plainToInstance(def.dto as new () => object, dto.payload);
    const errors = await validate(item, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) {
      throw new BadRequestException(errors.flatMap((e) => Object.values(e.constraints ?? {})));
    }
    const props = toRosProps(item);
    const { 'place-before': _placeBefore, ...matchProps } = props;

    const routerIds = await this.routers.routerIdsInGroup(groupId);
    const routers = await Promise.all(routerIds.map((id) => this.routers.get(id)));

    const plan = await mapLimit(routers, CONCURRENCY, async (r): Promise<DeployPlanItem> => {
      try {
        const existing = await this.mikrotik.withClient(r.id, (c) => c.list(def.spec.path));
        const dup = existing.find((row) => Object.entries(matchProps).every(([k, v]) => norm(row[k]) === norm(v)));
        return dup
          ? { routerId: r.id, routerName: r.name, action: 'skip', reason: `already present as ${dup['.id']}` }
          : { routerId: r.id, routerName: r.name, action: 'create' };
      } catch (e) {
        return { routerId: r.id, routerName: r.name, action: 'error', reason: (e as Error).message };
      }
    });

    if (dto.dryRun) return { dryRun: true, kind: dto.kind, props, plan };

    await mapLimit(
      plan.filter((p) => p.action === 'create'),
      CONCURRENCY,
      async (p) => {
        try {
          const created = await this.net.create(p.routerId, def.spec, item, { user, meta });
          p.result = 'created';
          p.id = created['.id'];
        } catch (e) {
          p.result = 'failed';
          p.error = (e as Error).message;
        }
      },
    );

    const failed = plan.filter((p) => p.result === 'failed').length;
    await this.audit.record({
      action: 'BULK_DEPLOY',
      user,
      meta,
      targetType: def.spec.key,
      targetId: groupId,
      after: { props, plan },
      result: failed ? AuditResult.FAILURE : AuditResult.SUCCESS,
      error: failed ? `${failed} router(s) failed` : undefined,
    });
    return { dryRun: false, kind: dto.kind, props, plan };
  }
}

@Controller('router-groups/:groupId/deploy')
export class BulkController {
  constructor(private readonly bulk: BulkService) {}

  @Post()
  @HttpCode(200)
  @RequireAnyPermission(P.FIREWALL_WRITE, P.FIREWALL_ADDRESS_LIST)
  deploy(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body() dto: DeployDto,
    @CurrentUser() user: AuthUser,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.bulk.deploy(groupId, dto, user, meta);
  }
}
