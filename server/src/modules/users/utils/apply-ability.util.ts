import { Logger } from '@nestjs/common';
import { Brackets, SelectQueryBuilder } from 'typeorm';
import type { AppAbility } from '../../auth/casl/app-ability';
import type { User } from '../entities/user.entity';

const logger = new Logger('applyAbilityToUserQuery');

const USER_FIELD_MAP: Record<string, string> = {
  id: 'user.id',
  email: 'user.email',
  firstName: 'user.firstName',
  lastName: 'user.lastName',
  isActive: 'user.isActive'
};

const COMPARISON_OPERATORS = {
  $eq: '=',
  $ne: '<>',
  $gt: '>',
  $gte: '>=',
  $lt: '<',
  $lte: '<='
} as const;

const LIST_OPERATORS = {
  $in: 'IN',
  $nin: 'NOT IN'
} as const;

const LOGICAL_OPERATORS = new Set(['$and', '$or', '$nor', '$not']);

interface TranslationContext {
  paramIdx: { value: number };
  params: Record<string, unknown>;
}

interface SkipRule {
  skip: true;
  reason: string;
}

type Fragment = string | SkipRule;

function isSkip(f: Fragment): f is SkipRule {
  return typeof f !== 'string';
}

function isPrimitive(v: unknown): v is string | number | boolean {
  return (
    typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Date)
  );
}

function nextParam(ctx: TranslationContext): string {
  return `abFilter_${ctx.paramIdx.value++}`;
}

function isAcceptableScalar(
  v: unknown
): v is string | number | boolean | Date | null {
  return v === null || isPrimitive(v) || v instanceof Date;
}

function translateField(
  column: string,
  value: unknown,
  ctx: TranslationContext
): Fragment {
  if (isAcceptableScalar(value)) {
    const p = nextParam(ctx);
    ctx.params[p] = value;
    return `${column} = :${p}`;
  }

  if (!isPlainObject(value)) {
    return { skip: true, reason: `unsupported value shape for field` };
  }

  const ops = Object.entries(value);
  if (ops.length === 0) {
    return { skip: true, reason: `empty operator object` };
  }

  const fragments: string[] = [];
  for (const [op, opVal] of ops) {
    if (op in COMPARISON_OPERATORS) {
      if (!isAcceptableScalar(opVal)) {
        return { skip: true, reason: `${op} value must be a scalar` };
      }
      const sqlOp =
        COMPARISON_OPERATORS[op as keyof typeof COMPARISON_OPERATORS];
      const p = nextParam(ctx);
      ctx.params[p] = opVal;
      fragments.push(`${column} ${sqlOp} :${p}`);
      continue;
    }

    if (op in LIST_OPERATORS) {
      if (!Array.isArray(opVal)) {
        return { skip: true, reason: `${op} value must be an array` };
      }
      if (opVal.length === 0) {
        return { skip: true, reason: `${op} array is empty` };
      }
      const sqlOp = LIST_OPERATORS[op as keyof typeof LIST_OPERATORS];
      const p = nextParam(ctx);
      ctx.params[p] = opVal;
      fragments.push(`${column} ${sqlOp} (:...${p})`);
      continue;
    }

    return { skip: true, reason: `unknown operator "${op}"` };
  }

  return fragments.length === 1 ? fragments[0] : `(${fragments.join(' AND ')})`;
}

function translateLogical(
  op: string,
  value: unknown,
  ctx: TranslationContext
): Fragment {
  if (op === '$not') {
    if (!isPlainObject(value)) {
      return { skip: true, reason: '$not value must be an object' };
    }
    const sub = translate(value, ctx);
    if (isSkip(sub)) return sub;
    return `NOT (${sub})`;
  }

  if (!Array.isArray(value)) {
    return { skip: true, reason: `${op} value must be an array` };
  }
  if (value.length === 0) {
    return { skip: true, reason: `${op} array is empty` };
  }

  const subs: string[] = [];
  for (const child of value) {
    if (!isPlainObject(child)) {
      return { skip: true, reason: `${op} array element must be an object` };
    }
    const sub = translate(child, ctx);
    if (isSkip(sub)) return sub;
    subs.push(sub);
  }

  if (op === '$and') return `(${subs.join(' AND ')})`;
  if (op === '$or') return `(${subs.join(' OR ')})`;
  return `NOT (${subs.join(' OR ')})`;
}

function translate(
  node: Record<string, unknown>,
  ctx: TranslationContext
): Fragment {
  const fragments: string[] = [];

  for (const [key, value] of Object.entries(node)) {
    if (LOGICAL_OPERATORS.has(key)) {
      const sub = translateLogical(key, value, ctx);
      if (isSkip(sub)) return sub;
      fragments.push(sub);
      continue;
    }

    if (key.startsWith('$')) {
      return { skip: true, reason: `unknown operator "${key}"` };
    }

    const column = USER_FIELD_MAP[key];
    if (!column) {
      return { skip: true, reason: `unknown field "${key}"` };
    }

    const sub = translateField(column, value, ctx);
    if (isSkip(sub)) return sub;
    fragments.push(sub);
  }

  if (fragments.length === 0) {
    return { skip: true, reason: 'empty conditions object' };
  }

  return fragments.length === 1 ? fragments[0] : `(${fragments.join(' AND ')})`;
}

/**
 * Restrict a User QueryBuilder to the rows the caller's CASL ability can
 * access for the given action. Rules without conditions grant full access;
 * otherwise rule conditions are translated to TypeORM WHERE fragments and
 * ORed together. A caller with no matching allow rule sees no rows.
 *
 * Translates MongoQuery fragments produced by CaslAbilityFactory:
 *   - field equality:        `{ field: scalar }`
 *   - comparison operators:  `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`
 *   - list operators:        `$in`, `$nin`
 *   - logical operators:     `$and`, `$or`, `$nor`, `$not`
 *
 * Fail-closed: if a rule contains any unknown operator, unknown field, or
 * unsupported value shape, the ENTIRE rule is dropped (and a warn logged).
 * Partial translation would produce SQL strictly less restrictive than the
 * source rule and silently over-share — see BKL-008.
 */
export function applyAbilityToUserQuery(
  qb: SelectQueryBuilder<User>,
  ability: AppAbility,
  action: string
): SelectQueryBuilder<User> {
  if (ability.can('manage', 'all') || ability.can(action, 'all')) {
    return qb;
  }

  const rules = ability.rulesFor(action, 'User').filter((r) => !r.inverted);

  if (rules.length === 0) {
    qb.andWhere('1 = 0');
    return qb;
  }

  if (rules.some((r) => !r.conditions)) {
    return qb;
  }

  qb.andWhere(
    new Brackets((bqb) => {
      const paramIdx = { value: 0 };
      let first = true;
      for (const rule of rules) {
        const ruleParams: Record<string, unknown> = {};
        const startIdx = paramIdx.value;
        const ctx: TranslationContext = { paramIdx, params: ruleParams };
        const result = translate(
          rule.conditions as Record<string, unknown>,
          ctx
        );
        if (isSkip(result)) {
          // Roll back partially-consumed param indices so surviving rules keep
          // contiguous numbering (purely cosmetic — SQL is correct either way).
          paramIdx.value = startIdx;
          logger.warn(
            `Skipping CASL rule with untranslatable conditions (${result.reason}): ${JSON.stringify(rule.conditions)}`
          );
          continue;
        }
        if (first) {
          bqb.where(result, ruleParams);
          first = false;
        } else {
          bqb.orWhere(result, ruleParams);
        }
      }
      if (first) {
        bqb.where('1 = 0');
      }
    })
  );

  return qb;
}
