import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRule,
  createGroup,
  resetIdCounter,
  parseValue,
  jsonToModel,
  modelToJson
} from './condition-builder.types';

describe('condition-builder types', () => {
  beforeEach(() => {
    resetIdCounter();
  });

  describe('parseValue', () => {
    it('parses "true" as boolean true', () => {
      expect(parseValue('true')).toBe(true);
    });

    it('parses "false" as boolean false', () => {
      expect(parseValue('false')).toBe(false);
    });

    it('parses "null" as null', () => {
      expect(parseValue('null')).toBe(null);
    });

    it('parses numeric strings as numbers', () => {
      expect(parseValue('42')).toBe(42);
      expect(parseValue('3.14')).toBe(3.14);
      expect(parseValue('-1')).toBe(-1);
    });

    it('returns string for non-numeric text', () => {
      expect(parseValue('hello')).toBe('hello');
    });

    it('returns empty string for empty input', () => {
      expect(parseValue('')).toBe('');
    });

    it('trims whitespace', () => {
      expect(parseValue('  42  ')).toBe(42);
      expect(parseValue('  true  ')).toBe(true);
    });
  });

  describe('jsonToModel', () => {
    it('parses simple equality: { "status": "active" }', () => {
      const group = jsonToModel({ status: 'active' });
      expect(group).not.toBeNull();
      expect(group!.logic).toBe('$and');
      expect(group!.children).toHaveLength(1);
      expect(group!.children[0].type).toBe('rule');

      const rule = (
        group!.children[0] as {
          type: 'rule';
          rule: { field: string; operator: string; value: string };
        }
      ).rule;
      expect(rule.field).toBe('status');
      expect(rule.operator).toBe('$eq');
      expect(rule.value).toBe('active');
    });

    it('parses comparison operator: { "age": { "$gt": 18 } }', () => {
      const group = jsonToModel({ age: { $gt: 18 } });
      expect(group).not.toBeNull();

      const rule = (
        group!.children[0] as {
          type: 'rule';
          rule: { field: string; operator: string; value: string };
        }
      ).rule;
      expect(rule.field).toBe('age');
      expect(rule.operator).toBe('$gt');
      expect(rule.value).toBe('18');
    });

    it('parses $in operator: { "role": { "$in": ["admin", "editor"] } }', () => {
      const group = jsonToModel({ role: { $in: ['admin', 'editor'] } });
      const rule = (
        group!.children[0] as {
          type: 'rule';
          rule: { field: string; operator: string; value: string };
        }
      ).rule;
      expect(rule.operator).toBe('$in');
      expect(rule.value).toBe('admin, editor');
    });

    it('parses $or group', () => {
      const group = jsonToModel({
        $or: [{ status: 'active' }, { status: 'pending' }]
      });
      expect(group!.logic).toBe('$or');
      expect(group!.children).toHaveLength(2);
    });

    it('parses $and group', () => {
      const group = jsonToModel({
        $and: [{ status: 'active' }, { age: { $gt: 18 } }]
      });
      expect(group!.logic).toBe('$and');
      expect(group!.children).toHaveLength(2);
    });

    it('parses nested groups', () => {
      const group = jsonToModel({
        $or: [
          { status: 'active' },
          { $and: [{ age: { $gt: 18 } }, { role: 'editor' }] }
        ]
      });
      expect(group!.logic).toBe('$or');
      expect(group!.children).toHaveLength(2);
      expect(group!.children[1].type).toBe('group');

      const nested = (
        group!.children[1] as {
          type: 'group';
          group: { logic: string; children: unknown[] };
        }
      ).group;
      expect(nested.logic).toBe('$and');
      expect(nested.children).toHaveLength(2);
    });

    it('parses multiple top-level fields as implicit $and', () => {
      const group = jsonToModel({ status: 'active', age: { $gte: 21 } });
      expect(group!.logic).toBe('$and');
      expect(group!.children).toHaveLength(2);
    });

    it('parses empty object', () => {
      const group = jsonToModel({});
      expect(group).not.toBeNull();
      expect(group!.children).toHaveLength(0);
    });

    it('parses $exists operator', () => {
      const group = jsonToModel({ deletedAt: { $exists: false } });
      const rule = (
        group!.children[0] as {
          type: 'rule';
          rule: { field: string; operator: string; value: string };
        }
      ).rule;
      expect(rule.operator).toBe('$exists');
      expect(rule.value).toBe('false');
    });
  });

  describe('modelToJson', () => {
    it('serializes a single $eq rule as flat object', () => {
      const group = createGroup('$and', [
        { type: 'rule', rule: createRule('status', '$eq', 'active') }
      ]);
      expect(modelToJson(group)).toEqual({ status: 'active' });
    });

    it('serializes $gt rule', () => {
      const group = createGroup('$and', [
        { type: 'rule', rule: createRule('age', '$gt', '18') }
      ]);
      expect(modelToJson(group)).toEqual({ age: { $gt: 18 } });
    });

    it('serializes $in with comma-separated values', () => {
      const group = createGroup('$and', [
        { type: 'rule', rule: createRule('role', '$in', 'admin, editor') }
      ]);
      expect(modelToJson(group)).toEqual({
        role: { $in: ['admin', 'editor'] }
      });
    });

    it('serializes $exists as boolean', () => {
      const group = createGroup('$and', [
        { type: 'rule', rule: createRule('field', '$exists', 'true') }
      ]);
      expect(modelToJson(group)).toEqual({ field: { $exists: true } });
    });

    it('serializes $or group', () => {
      const group = createGroup('$or', [
        { type: 'rule', rule: createRule('a', '$eq', '1') },
        { type: 'rule', rule: createRule('b', '$eq', '2') }
      ]);
      expect(modelToJson(group)).toEqual({
        $or: [{ a: 1 }, { b: 2 }]
      });
    });

    it('serializes nested groups', () => {
      const inner = createGroup('$and', [
        { type: 'rule', rule: createRule('x', '$eq', 'y') }
      ]);
      const outer = createGroup('$or', [
        { type: 'rule', rule: createRule('a', '$eq', '1') },
        { type: 'group', group: inner }
      ]);
      expect(modelToJson(outer)).toEqual({
        $or: [{ a: 1 }, { x: 'y' }]
      });
    });

    it('flattens $and with unique fields', () => {
      const group = createGroup('$and', [
        { type: 'rule', rule: createRule('status', '$eq', 'active') },
        { type: 'rule', rule: createRule('age', '$gt', '18') }
      ]);
      expect(modelToJson(group)).toEqual({
        status: 'active',
        age: { $gt: 18 }
      });
    });

    it('uses $and array when duplicate fields exist', () => {
      const group = createGroup('$and', [
        { type: 'rule', rule: createRule('status', '$eq', 'active') },
        { type: 'rule', rule: createRule('status', '$ne', 'deleted') }
      ]);
      const result = modelToJson(group);
      expect(result).toHaveProperty('$and');
    });

    it('serializes empty group as empty object', () => {
      const group = createGroup('$and', []);
      expect(modelToJson(group)).toEqual({});
    });
  });

  describe('roundtrip: jsonToModel → modelToJson', () => {
    const cases: [string, Record<string, unknown>][] = [
      ['simple equality', { status: 'active' }],
      ['comparison', { age: { $gt: 18 } }],
      ['$in', { role: { $in: ['admin', 'editor'] } }],
      ['$or group', { $or: [{ status: 'active' }, { status: 'pending' }] }],
      ['multiple fields', { status: 'active', age: { $gte: 21 } }]
    ];

    for (const [name, input] of cases) {
      it(`roundtrips: ${name}`, () => {
        const model = jsonToModel(input);
        expect(model).not.toBeNull();
        expect(modelToJson(model!)).toEqual(input);
      });
    }
  });
});
