import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ROS_ID_RE } from '../../mikrotik/types';

/** Validates RouterOS internal ids ("*1A") in route params. */
@Injectable()
export class RosIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!ROS_ID_RE.test(value)) throw new BadRequestException('Invalid RouterOS item id');
    return value;
  }
}
