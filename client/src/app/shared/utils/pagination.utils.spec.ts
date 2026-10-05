import { HttpParams } from '@angular/common/http';
import { isActiveFilterValue, listQueryParams } from './pagination.utils';

describe('listQueryParams', () => {
  it('sends each set filter in the form the server parses', () => {
    const params = listQueryParams(new HttpParams().set('limit', '20'), {
      q: 'beta',
      enabled: false,
      ids: ['a', 'b']
    });

    expect(params.toString()).toBe('limit=20&q=beta&enabled=false&ids=a,b');
  });

  it('leaves off a value that narrows nothing', () => {
    const params = listQueryParams(new HttpParams(), {
      q: '',
      enabled: undefined,
      ids: [],
      role: null
    });

    expect(params.keys()).toEqual([]);
  });
});

describe('isActiveFilterValue', () => {
  it.each([
    [undefined, false],
    [null, false],
    ['', false],
    [[], false],
    [false, true],
    ['x', true],
    [['a'], true]
  ])('reads %p as %p', (value, expected) => {
    expect(isActiveFilterValue(value)).toBe(expected);
  });
});
