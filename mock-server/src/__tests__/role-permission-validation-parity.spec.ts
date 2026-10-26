import type { Server } from 'http';
import { createApp } from '../app';
import { baseUrlOf, listenOnUnblockedPort } from '../utils/listen';
import { resetState } from '../state';
import { mockId } from '../utils/mock-id';

// Each expected list is the output of the server ValidationPipe, with the
// options of `main.ts`, on `AssignPermissionsDto` or `SetPermissionsDto` for
// the same body.

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  resetState();
  server = await listenOnUnblockedPort(createApp());
  baseUrl = baseUrlOf(server);
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  resetState();
});

async function adminToken(): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'Password1' })
  });
  const body = (await res.json()) as { tokens: { access_token: string } };
  return body.tokens.access_token;
}

async function send(method: 'POST' | 'PUT', body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/roles/${mockId('role-editor')}/permissions`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${await adminToken()}`
    },
    body: JSON.stringify(body)
  });
}

const ID = '11111111-1111-4111-8111-111111111111';
const many = (count: number, value: unknown): unknown[] =>
  Array.from({ length: count }, () => value);

const PERMISSION_IDS_MISSING = [
  'each value in permissionIds must be a UUID',
  'permissionIds must contain no more than 500 elements',
  'permissionIds should not be empty',
  'permissionIds must be an array'
];
const NESTED_ITEM =
  'each value in nested property items must be either object or array';

describe('POST /roles/:id/permissions validation parity', () => {
  it.each<[string, unknown, string[]]>([
    ['an empty body', {}, PERMISSION_IDS_MISSING],
    ['a null permissionIds', { permissionIds: null }, PERMISSION_IDS_MISSING],
    [
      'an unknown property and a string permissionIds',
      { extra: 1, permissionIds: 'x' },
      ['property extra should not exist', ...PERMISSION_IDS_MISSING]
    ],
    [
      'a UUID string in place of the array',
      { permissionIds: ID },
      PERMISSION_IDS_MISSING.slice(1)
    ],
    [
      'ids that are not UUIDs',
      { permissionIds: ['bad', 5] },
      ['each value in permissionIds must be a UUID']
    ],
    [
      'a UUID that is not version 4',
      { permissionIds: ['11111111-1111-1111-8111-111111111111'] },
      ['each value in permissionIds must be a UUID']
    ],
    [
      'an empty array',
      { permissionIds: [] },
      ['permissionIds should not be empty']
    ],
    [
      '501 ids',
      { permissionIds: many(501, ID) },
      ['permissionIds must contain no more than 500 elements']
    ],
    [
      '501 ids that are not UUIDs',
      { permissionIds: many(501, 'x') },
      [
        'each value in permissionIds must be a UUID',
        'permissionIds must contain no more than 500 elements'
      ]
    ],
    [
      'a bad effect and a number custom',
      { permissionIds: [ID], conditions: { effect: 'x', custom: 5 } },
      [
        'conditions.effect must be one of the following values: allow, deny',
        'conditions.custom must be a JSON string',
        'conditions.custom must be a string'
      ]
    ],
    [
      'a number conditions',
      { permissionIds: [ID], conditions: 5 },
      [
        'conditions must be an object',
        'nested property conditions must be either object or array'
      ]
    ],
    [
      'an empty array conditions',
      { permissionIds: [ID], conditions: [] },
      ['conditions must be an object']
    ],
    [
      'a deny inside an array conditions',
      { permissionIds: [ID], conditions: [{ effect: 'deny' }] },
      ['conditions must be an object']
    ],
    [
      'an array conditions with a bad entry and a number entry',
      { permissionIds: [ID], conditions: [{ effect: 'x' }, 5] },
      [
        'conditions.0.effect must be one of the following values: allow, deny',
        'conditions.nested property conditions must be either object or array'
      ]
    ],
    [
      'a nested array conditions',
      { permissionIds: [ID], conditions: [[{ effect: 'x' }]] },
      ['conditions.0.0.effect must be one of the following values: allow, deny']
    ],
    [
      'unknown condition keys among bad branches',
      {
        permissionIds: [ID],
        conditions: { b: 1, effect: 'x', a: 2, ownership: 5 }
      },
      [
        'conditions.property b should not exist',
        'conditions.property a should not exist',
        'conditions.effect must be one of the following values: allow, deny',
        'conditions.ownership must be an object',
        'conditions.ownership must be an object'
      ]
    ],
    [
      'branches that are arrays',
      {
        permissionIds: [ID],
        conditions: { ownership: [], fieldMatch: [], userAttr: [] }
      },
      [
        'conditions.ownership must be an object',
        'conditions.ownership must be an object',
        'conditions.fieldMatch must be an object',
        'conditions.fieldMatch must be an object',
        'conditions.userAttr must be an object',
        'conditions.userAttr must be an object'
      ]
    ],
    [
      'branches of a wrong shape',
      {
        permissionIds: [ID],
        conditions: {
          ownership: {},
          fieldMatch: { name: [] },
          userAttr: { name: 1 }
        }
      },
      [
        'conditions.ownership must have exactly one key "userField"',
        'conditions.fieldMatch.name must be a non-empty array of values',
        'conditions.userAttr.name must be a non-empty attribute name string'
      ]
    ],
    [
      'a custom that is not JSON',
      { permissionIds: [ID], conditions: { custom: 'nope' } },
      ['conditions.custom must be valid JSON']
    ],
    [
      'a custom that is a JSON array',
      { permissionIds: [ID], conditions: { custom: '[1]' } },
      ['conditions.custom must be a JSON object']
    ],
    [
      'a custom with a denied operator',
      { permissionIds: [ID], conditions: { custom: '{"$where":1}' } },
      ['conditions.Operator "$where" is not allowed at ']
    ],
    [
      'every kind of fault at once',
      {
        extra: 1,
        permissionIds: ['bad'],
        conditions: { effect: 'x', more: 1 }
      },
      [
        'property extra should not exist',
        'each value in permissionIds must be a UUID',
        'conditions.property more should not exist',
        'conditions.effect must be one of the following values: allow, deny'
      ]
    ]
  ])('lists every violation of %s', async (_label, body, expected) => {
    const res = await send('POST', body);

    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors).toEqual(
      expected
    );
  });
});

describe('PUT /roles/:id/permissions validation parity', () => {
  it.each<[string, unknown, string[]]>([
    [
      'an empty body',
      {},
      [
        'each value in items must be an object',
        'items must contain no more than 500 elements',
        'items must be an array'
      ]
    ],
    [
      'an unknown property and a string items',
      { extra: 1, items: 'x' },
      [
        'property extra should not exist',
        'each value in items must be an object',
        'items must contain no more than 500 elements',
        'items must be an array',
        NESTED_ITEM
      ]
    ],
    [
      'a null items',
      { items: null },
      [
        'each value in items must be an object',
        'items must contain no more than 500 elements',
        'items must be an array',
        NESTED_ITEM
      ]
    ],
    [
      'a plain object items',
      { items: { permissionId: 'bad' } },
      ['items.permissionId must be a UUID']
    ],
    [
      'an item with no UUID',
      { items: [{ permissionId: 'bad' }] },
      ['items.0.permissionId must be a UUID']
    ],
    ['an empty item', { items: [{}] }, ['items.0.permissionId must be a UUID']],
    ['a number item', { items: [5] }, [`items.${NESTED_ITEM}`]],
    [
      'an array item',
      { items: [[]] },
      ['each value in items must be an object']
    ],
    [
      'an array item next to a bad item',
      { items: [[], { permissionId: 'bad' }] },
      ['items.1.permissionId must be a UUID']
    ],
    [
      'a nested array item',
      { items: [[{ permissionId: 'bad' }]] },
      ['items.0.0.permissionId must be a UUID']
    ],
    ['a nested number item', { items: [[5]] }, [`items.0.${NESTED_ITEM}`]],
    [
      'an unknown item property',
      { items: [{ permissionId: ID, extra: 1 }] },
      ['items.0.property extra should not exist']
    ],
    [
      'a number item conditions',
      { items: [{ permissionId: ID, conditions: 5 }] },
      [
        'items.0.conditions must be an object',
        'items.0.nested property conditions must be either object or array'
      ]
    ],
    [
      'a deny inside an array item conditions',
      { items: [{ permissionId: ID, conditions: [{ effect: 'deny' }] }] },
      ['items.0.conditions must be an object']
    ],
    [
      'an array item conditions with a bad entry and a number entry',
      { items: [{ permissionId: ID, conditions: [{ effect: 'x' }, 5] }] },
      [
        'items.0.conditions.0.effect must be one of the following values: allow, deny',
        'items.0.conditions.nested property conditions must be either object or array',
        'items.0.conditions must be an object'
      ]
    ],
    [
      'faults in two items',
      {
        items: [
          { permissionId: ID, conditions: { effect: 'x', custom: 5 } },
          { permissionId: 'bad' }
        ]
      },
      [
        'items.0.conditions.effect must be one of the following values: allow, deny',
        'items.0.conditions.custom must be a JSON string',
        'items.0.conditions.custom must be a string',
        'items.1.permissionId must be a UUID'
      ]
    ],
    [
      'faults on every level of one item',
      { items: [{ permissionId: 'bad', extra: 1, conditions: { extra: 2 } }] },
      [
        'items.0.property extra should not exist',
        'items.0.permissionId must be a UUID',
        'items.0.conditions.property extra should not exist'
      ]
    ],
    [
      '501 items',
      { items: many(501, { permissionId: ID }) },
      ['items must contain no more than 500 elements']
    ],
    [
      '501 items with a bad first item',
      { items: [{ permissionId: 'bad' }, ...many(500, { permissionId: ID })] },
      ['items.0.permissionId must be a UUID']
    ],
    [
      '501 items with an array first item',
      { items: [[], ...many(500, { permissionId: ID })] },
      [
        'each value in items must be an object',
        'items must contain no more than 500 elements'
      ]
    ],
    [
      '501 number items',
      { items: many(501, 5) },
      many(501, `items.${NESTED_ITEM}`) as string[]
    ]
  ])('lists every violation of %s', async (_label, body, expected) => {
    const res = await send('PUT', body);

    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors).toEqual(
      expected
    );
  });
});
