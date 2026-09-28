import { RouterNotFoundError } from '../errors';
import {
  assertCommand,
  assertId,
  assertPath,
  assertProps,
  MenuPath,
  PrintOptions,
  RosCommand,
  RosProps,
  RosRecord,
  RouterAdapter,
} from '../types';
import { RouterOsApiClient } from './api-client';
import type { Reply } from './protocol';

const toWords = (props: RosProps) => Object.entries(props).map(([k, v]) => `=${k}=${v}`);
const rows = (replies: Reply[]) => replies.filter((r) => r.type === '!re').map((r) => r.attrs);

/** RouterOS API (8728 / 8729) implementation of {@link RouterAdapter}. */
export class ApiRouterAdapter implements RouterAdapter {
  readonly transport = 'API' as const;

  constructor(private readonly client: RouterOsApiClient) {}

  get isOpen(): boolean {
    return this.client.isOpen;
  }

  async print(path: MenuPath, opts: PrintOptions = {}): Promise<RosRecord[]> {
    assertPath(path);
    const words = [`${path}/print`];
    if (opts.proplist?.length) words.push(`=.proplist=${opts.proplist.join(',')}`);
    if (opts.where) {
      assertProps(opts.where);
      for (const [k, v] of Object.entries(opts.where)) words.push(`?${k}=${v}`);
    }
    return rows(await this.client.send(words));
  }

  async get(path: MenuPath, id: string): Promise<RosRecord> {
    assertPath(path);
    assertId(id);
    const [row] = rows(await this.client.send([`${path}/print`, `?.id=${id}`]));
    if (!row) throw new RouterNotFoundError(`${path} ${id} not found`);
    return row;
  }

  async add(path: MenuPath, props: RosProps): Promise<string> {
    assertPath(path);
    assertProps(props);
    const replies = await this.client.send([`${path}/add`, ...toWords(props)]);
    return replies.find((r) => r.type === '!done')?.attrs.ret ?? '';
  }

  async set(path: MenuPath, id: string, props: RosProps): Promise<void> {
    assertPath(path);
    assertId(id);
    assertProps(props);
    await this.client.send([`${path}/set`, `=.id=${id}`, ...toWords(props)]);
  }

  async remove(path: MenuPath, id: string): Promise<void> {
    assertPath(path);
    assertId(id);
    await this.client.send([`${path}/remove`, `=.id=${id}`]);
  }

  async command(path: MenuPath, command: RosCommand, params: RosProps = {}): Promise<RosRecord[]> {
    assertPath(path);
    assertCommand(command);
    assertProps(params);
    return rows(await this.client.send([`${path}/${command}`, ...toWords(params)]));
  }

  close(): Promise<void> {
    return this.client.close();
  }
}
