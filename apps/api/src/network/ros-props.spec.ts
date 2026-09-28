import { toRosProps } from './ros-props';

describe('toRosProps', () => {
  it('maps camelCase DTO fields to RouterOS properties', () => {
    expect(
      toRosProps({
        chain: 'input',
        action: 'drop',
        srcAddress: '10.0.0.0/8',
        dstPort: '22',
        inInterfaceList: 'WAN',
        placeBefore: '*3',
        log: true,
        disabled: false,
        distance: 5,
        comment: undefined,
      }),
    ).toEqual({
      chain: 'input',
      action: 'drop',
      'src-address': '10.0.0.0/8',
      'dst-port': '22',
      'in-interface-list': 'WAN',
      'place-before': '*3',
      log: 'yes',
      disabled: 'no',
      distance: '5',
    });
  });
});
