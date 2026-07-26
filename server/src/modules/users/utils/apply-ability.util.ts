import { Logger } from '@nestjs/common';
import { Brackets, SelectQueryBuilder } from 'typeorm';
import type { AppAbility } from '../../auth/casl/app-ability';
import type { User } from '../entities/user.entity';

const logger = new Logger('applyAbilityToUserQuery');

// All mapped columns are NOT NULL, so SQL three-valued logic cannot diverge
// from ucast's in-memory can() for $ne/$nin. If a NULLABLE column is ever added
// here, `<>` / `NOT IN` will silently exclude NULL rows that can() includes —
// add a NULL-parity test (instance-check vs list-filter) at that point.
const USER_FIELD_MAP: Record<string, string> = {
  id: 'user.id',
  email: 'user.email',
  firstName: 'user.firstName',
  lastName: 'user.lastName',
  isActive: 'user.isActive'
};

// These three maps are the SQL-side representation of the operators accepted by
// the shared ALLOWED_MONGO_OPERATORS whitelist. Their union of keys MUST equal
// that set (asserted by the drift-guard test in apply-ability.util.spec.ts) —
// adding an operator to the whitelist without a translation here would make a
// permission grant a single record yet return zero rows in list/search.
export const COMPARISON_OPERATORS = {
  $eq: '=',
  $ne: '<>',
  $gt: '>',
  $gte: '>=',
  $lt: '<',
  $lte: '<='
} as const;

export const LIST_OPERATORS = {
  $in: 'IN',
  $nin: 'NOT IN'
} as const;

export const LOGICAL_OPERATORS = new Set(['$and', '$or', '$nor', '$not']);

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

type RuleSetTranslation =
  // At least one rule in the set carries no conditions: it matches every row.
  | { kind: 'always'; skipped: boolean }
  // No rule survived translation: the set matches no row.
  | { kind: 'never'; skipped: boolean }
  | {
      kind: 'conditional';
      sql: string;
      params: Record<string, unknown>;
      skipped: boolean;
    };

/**
 * Translate one homogeneous set of rules (all allows, or all denies) into a
 * single SQL fragment. Rules within a set are ORed: CASL treats each rule as an
 * independent grant of the same polarity.
 *
 * `skipped` reports whether any rule was dropped as untranslatable. Dropping an
 * allow only narrows the result, but dropping a deny would widen it, so the two
 * sets are handled differently by the caller.
 */
function translateRuleSet(
  rules: { conditions?: unknown }[],
  paramIdx: { value: number }
): RuleSetTranslation {
  if (rules.some((r) => !r.conditions)) {
    return { kind: 'always', skipped: false };
  }

  const params: Record<string, unknown> = {};
  const fragments: string[] = [];
  let skipped = false;

  for (const rule of rules) {
    const ruleParams: Record<string, unknown> = {};
    const startIdx = paramIdx.value;
    const result = translate(rule.conditions as Record<string, unknown>, {
      paramIdx,
      params: ruleParams
    });
    if (isSkip(result)) {
      // Roll back partially-consumed param indices so surviving rules keep
      // contiguous numbering (purely cosmetic — SQL is correct either way).
      paramIdx.value = startIdx;
      skipped = true;
      logger.warn(
        `Skipping CASL rule with untranslatable conditions (${result.reason}): ${JSON.stringify(rule.conditions)}`
      );
      continue;
    }
    Object.assign(params, ruleParams);
    fragments.push(result);
  }

  if (fragments.length === 0) {
    return { kind: 'never', skipped };
  }

  return {
    kind: 'conditional',
    sql: fragments.length === 1 ? fragments[0] : `(${fragments.join(' OR ')})`,
    params,
    skipped
  };
}

/**
 * Restrict a User QueryBuilder to the rows the caller's CASL ability can
 * access for the given action. Allow rules without conditions grant full
 * access; otherwise rule conditions are translated to TypeORM WHERE fragments,
 * ORed within each polarity and combined as `allow AND NOT deny`. A caller with
 * no matching allow rule sees no rows.
 *
 * `CaslAbilityFactory` registers every allow before every deny, and CASL
 * resolves a check with the last-declared matching rule (`relevantRuleFor`
 * walks `rulesFor` output, which is ordered newest-declared first). So a
 * matching deny always outranks every allow, which makes `allow AND NOT deny`
 * an exact translation of the in-memory semantics, not an approximation.
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
 * source rule and silently over-share. For a deny, dropping the rule is itself
 * a widening, so an untranslatable deny degrades the whole query to no rows.
 */
export function applyAbilityToUserQuery(
  qb: SelectQueryBuilder<User>,
  ability: AppAbility,
  action: string
): SelectQueryBuilder<User> {
  if (ability.can('manage', 'all') || ability.can(action, 'all')) {
    return qb;
  }

  const rules = ability.rulesFor(action, 'User');
  const allowRules = rules.filter((r) => !r.inverted);
  const denyRules = rules.filter((r) => r.inverted);

  if (allowRules.length === 0) {
    qb.andWhere('1 = 0');
    return qb;
  }

  const paramIdx = { value: 0 };
  const allow = translateRuleSet(allowRules, paramIdx);
  const deny =
    denyRules.length > 0
      ? translateRuleSet(denyRules, paramIdx)
      : ({ kind: 'never', skipped: false } as const);

  if (deny.kind === 'always' || deny.skipped) {
    logger.warn(
      deny.kind === 'always'
        ? 'Unconditional deny rule matches every row — restricting query to no rows'
        : 'Untranslatable deny rule cannot be enforced in SQL — restricting query to no rows'
    );
    qb.andWhere('1 = 0');
    return qb;
  }

  if (allow.kind === 'always' && deny.kind === 'never') {
    return qb;
  }

  qb.andWhere(
    new Brackets((bqb) => {
      if (allow.kind === 'never') {
        bqb.where('1 = 0');
        return;
      }
      if (allow.kind === 'conditional') {
        bqb.where(allow.sql, allow.params);
      }
      if (deny.kind === 'conditional') {
        const negated = `NOT (${deny.sql})`;
        if (allow.kind === 'always') {
          bqb.where(negated, deny.params);
        } else {
          bqb.andWhere(negated, deny.params);
        }
      }
    })
  );

  return qb;
}
