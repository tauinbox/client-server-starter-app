/**
 * Translation of CASL rule conditions (MongoQuery) into SQL WHERE fragments.
 * The server applies the fragments to a list query. The mock server runs the
 * same translation to learn which rules survive it, so both drop the same
 * rules and show the same rows.
 */

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

/** Maps a condition field to its SQL column, or `undefined` when unknown. */
export type ColumnResolver = (field: string) => string | undefined;

interface TranslationContext {
  paramIdx: { value: number };
  params: Record<string, unknown>;
  columnFor: ColumnResolver;
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
      if (!opVal.every(isAcceptableScalar)) {
        return { skip: true, reason: `${op} array element must be a scalar` };
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

    const column = ctx.columnFor(key);
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

/** A rule that the translation dropped, and the reason. */
export interface SkippedRule {
  reason: string;
  conditions: unknown;
}

export type RuleSetTranslation<R> =
  // At least one rule in the set carries no conditions: it matches every row.
  | { kind: 'always'; skipped: SkippedRule[]; translated: R[] }
  // No rule survived translation: the set matches no row.
  | { kind: 'never'; skipped: SkippedRule[]; translated: R[] }
  | {
      kind: 'conditional';
      sql: string;
      params: Record<string, unknown>;
      skipped: SkippedRule[];
      translated: R[];
    };

/**
 * Translate one homogeneous set of rules (all allows, or all denies) into a
 * single SQL fragment. Rules within a set are ORed: CASL treats each rule as an
 * independent grant of the same polarity.
 *
 * `skipped` lists the rules dropped as untranslatable, and `translated` the
 * rules that the fragment holds. Dropping an allow only narrows the result,
 * but dropping a deny would widen it, so the caller handles the two sets
 * differently.
 */
export function translateRuleSet<R extends { conditions?: unknown }>(
  rules: R[],
  paramIdx: { value: number },
  columnFor: ColumnResolver
): RuleSetTranslation<R> {
  if (rules.some((r) => !r.conditions)) {
    return { kind: 'always', skipped: [], translated: rules };
  }

  const params: Record<string, unknown> = {};
  const fragments: string[] = [];
  const skipped: SkippedRule[] = [];
  const translated: R[] = [];

  for (const rule of rules) {
    const ruleParams: Record<string, unknown> = {};
    const startIdx = paramIdx.value;
    const result = translate(rule.conditions as Record<string, unknown>, {
      paramIdx,
      params: ruleParams,
      columnFor
    });
    if (isSkip(result)) {
      // Roll back partially-consumed param indices so surviving rules keep
      // contiguous numbering (purely cosmetic — SQL is correct either way).
      paramIdx.value = startIdx;
      skipped.push({ reason: result.reason, conditions: rule.conditions });
      continue;
    }
    Object.assign(params, ruleParams);
    fragments.push(result);
    translated.push(rule);
  }

  if (fragments.length === 0) {
    return { kind: 'never', skipped, translated };
  }

  return {
    kind: 'conditional',
    sql: fragments.length === 1 ? fragments[0] : `(${fragments.join(' OR ')})`,
    params,
    skipped,
    translated
  };
}
