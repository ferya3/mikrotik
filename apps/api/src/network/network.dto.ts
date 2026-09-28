import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  IsAddressMatcher,
  IsCidr,
  IsIpOrCidr,
  IsMac,
  IsPortSpec,
  IsRateLimit,
  IsRosComment,
  IsRosDuration,
  IsRosId,
  IsRosName,
  IsTargetList,
} from '../common/validation/routeros.validators';

/**
 * Structured request bodies. Each field maps 1:1 to a RouterOS property (camelCase → kebab-case),
 * and the global ValidationPipe rejects any field not declared here (forbidNonWhitelisted).
 * The backend — never the client — decides which RouterOS command is executed.
 */

const PROTOCOLS = ['tcp', 'udp', 'icmp', 'icmpv6', 'gre', 'ipsec-esp', 'ipsec-ah', 'ospf', 'sctp', 'l2tp', 'igmp'];
const CONN_STATES = ['established', 'related', 'new', 'invalid', 'untracked'];

class CommonProps {
  @IsOptional() @IsRosComment() comment?: string;
  @IsOptional() @IsBoolean() disabled?: boolean;
}

/** Ports without protocol tcp/udp/sctp are rejected by RouterOS itself and surfaced as HTTP 422. */
class MatcherProps extends CommonProps {
  @IsOptional() @IsIn(PROTOCOLS) protocol?: string;
  @IsOptional() @IsAddressMatcher() srcAddress?: string;
  @IsOptional() @IsAddressMatcher() dstAddress?: string;
  @IsOptional() @IsRosName() srcAddressList?: string;
  @IsOptional() @IsRosName() dstAddressList?: string;
  @IsOptional() @IsPortSpec() srcPort?: string;
  @IsOptional() @IsPortSpec() dstPort?: string;
  @IsOptional() @IsRosName() inInterface?: string;
  @IsOptional() @IsRosName() outInterface?: string;
  @IsOptional() @IsRosName() inInterfaceList?: string;
  @IsOptional() @IsRosName() outInterfaceList?: string;
}

// ── Firewall filter ─────────────────────────────────────
export class CreateFilterRuleDto extends MatcherProps {
  @Matches(/^(input|forward|output|[A-Za-z0-9_-]{1,32})$/) chain: string;

  @IsIn([
    'accept',
    'drop',
    'reject',
    'jump',
    'return',
    'log',
    'passthrough',
    'tarpit',
    'fasttrack-connection',
    'add-src-to-address-list',
    'add-dst-to-address-list',
  ])
  action: string;

  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value.join(',') : value))
  @Matches(new RegExp(`^(${CONN_STATES.join('|')})(,(${CONN_STATES.join('|')}))*$`))
  connectionState?: string;

  @ValidateIf((o) => o.action === 'jump') @IsNotEmpty() @Matches(/^[A-Za-z0-9_-]{1,32}$/) jumpTarget?: string;
  @ValidateIf((o) => o.action?.startsWith('add-')) @IsNotEmpty() @IsRosName() addressList?: string;
  @IsOptional() @IsRosDuration() addressListTimeout?: string;
  @IsOptional()
  @IsIn(['icmp-network-unreachable', 'icmp-host-unreachable', 'icmp-port-unreachable', 'icmp-admin-prohibited', 'tcp-reset'])
  rejectWith?: string;
  @IsOptional() @IsBoolean() log?: boolean;
  @IsOptional() @Matches(/^[\w .:-]{0,32}$/) logPrefix?: string;
  /** Insert before this rule instead of appending. */
  @IsOptional() @IsRosId() placeBefore?: string;
}

export class UpdateFilterRuleDto extends PartialType(OmitType(CreateFilterRuleDto, ['placeBefore'] as const)) {}

// ── NAT ─────────────────────────────────────────────────
export class CreateNatRuleDto extends MatcherProps {
  @Matches(/^(srcnat|dstnat|[A-Za-z0-9_-]{1,32})$/) chain: string;

  @IsIn(['masquerade', 'src-nat', 'dst-nat', 'netmap', 'redirect', 'accept', 'return', 'jump', 'passthrough', 'same'])
  action: string;

  @ValidateIf((o) => ['src-nat', 'dst-nat', 'netmap'].includes(o.action)) @IsNotEmpty() @IsAddressMatcher()
  toAddresses?: string;
  @IsOptional() @IsPortSpec() toPorts?: string;
  @ValidateIf((o) => o.action === 'jump') @IsNotEmpty() @Matches(/^[A-Za-z0-9_-]{1,32}$/) jumpTarget?: string;
  @IsOptional() @IsBoolean() log?: boolean;
  @IsOptional() @IsRosId() placeBefore?: string;
}

export class UpdateNatRuleDto extends PartialType(OmitType(CreateNatRuleDto, ['placeBefore'] as const)) {}

// ── Address lists ───────────────────────────────────────
export class CreateAddressListEntryDto extends CommonProps {
  @IsRosName() list: string;
  /** IP, CIDR, range or a DNS name (RouterOS resolves it). */
  @Matches(/^[A-Za-z0-9.:/\-]{1,253}$/) address: string;
  @IsOptional() @IsRosDuration() timeout?: string;
}

export class UpdateAddressListEntryDto extends PartialType(CreateAddressListEntryDto) {}

export class MoveRuleDto {
  /** Move the rule so it sits right before this rule. */
  @IsRosId() before: string;
}

// ── Interfaces ──────────────────────────────────────────
export class UpdateInterfaceDto extends CommonProps {
  @IsOptional() @IsInt() @Min(68) @Max(65535) mtu?: number;
}

// ── IP addresses ────────────────────────────────────────
export class CreateIpAddressDto extends CommonProps {
  @IsCidr() address: string;
  @IsRosName() interface: string;
}

export class UpdateIpAddressDto extends PartialType(CreateIpAddressDto) {}

// ── Routes ──────────────────────────────────────────────
export class CreateRouteDto extends CommonProps {
  @IsCidr() dstAddress: string;
  /** Next-hop IP or interface name. */
  @Matches(/^[\p{L}\p{N}_.:%@/-]{1,64}$/u) gateway: string;
  @IsOptional() @IsInt() @Min(1) @Max(255) distance?: number;
  /** RouterOS v7 routing table (v6 uses routing-mark). */
  @IsOptional() @IsRosName() routingTable?: string;
}

export class UpdateRouteDto extends PartialType(CreateRouteDto) {}

// ── DHCP ────────────────────────────────────────────────
export class CreateDhcpLeaseDto extends CommonProps {
  @IsIpOrCidr() address: string;
  @IsMac() macAddress: string;
  @IsOptional() @IsRosName() server?: string;
}

export class UpdateDhcpLeaseDto extends PartialType(CreateDhcpLeaseDto) {}

// ── PPP ─────────────────────────────────────────────────
export class CreatePppSecretDto extends CommonProps {
  @Matches(/^[\w.@-]{1,64}$/) name: string;
  @IsString() @IsNotEmpty() @MaxLength(64) password: string;
  @IsOptional() @IsIn(['any', 'pppoe', 'pptp', 'l2tp', 'ovpn', 'sstp', 'async']) service?: string;
  @IsOptional() @IsRosName() profile?: string;
  @IsOptional() @IsIpOrCidr() localAddress?: string;
  @IsOptional() @IsIpOrCidr() remoteAddress?: string;
}

export class UpdatePppSecretDto extends PartialType(CreatePppSecretDto) {}

// ── Queues ──────────────────────────────────────────────
export class CreateSimpleQueueDto extends CommonProps {
  @IsRosName() name: string;
  @IsTargetList() target: string;
  /** upload/download, e.g. 10M/50M */
  @IsOptional() @IsRateLimit() maxLimit?: string;
  @IsOptional() @IsRateLimit() limitAt?: string;
  @IsOptional() @IsRosName() parent?: string;
  @IsOptional() @Matches(/^[1-8]\/[1-8]$/) priority?: string;
}

export class UpdateSimpleQueueDto extends PartialType(CreateSimpleQueueDto) {}

// ── Logs ────────────────────────────────────────────────
export class LogQueryDto {
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(1000) limit = 200;
  @IsOptional() @Matches(/^[a-z-]{1,32}$/) topic?: string;
}
