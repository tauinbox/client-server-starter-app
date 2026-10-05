/**
 * The value each filter kind carries after the query string is parsed. Adding a
 * kind here makes the server, the mock and the client fail to compile until
 * each one handles it.
 */
export type ListFilterValueMap = {
  /** `?enabled=true` - an equality test on a boolean column. */
  boolean: boolean;
  /** `?email=ali` - a case-insensitive substring match on a text column. */
  contains: string;
  /** `?ids=<uuid>,<uuid>` - the row id is one of the listed ids. */
  uuidList: string[];
  /**
   * `?environment=production` - an array column that limits where the row
   * applies, with an empty array meaning everywhere: the row matches when the
   * array is empty or holds the value. The value must be one of `values`.
   */
  scopeIncludes: string;
  /** `?mfaEnabled=true` - the nullable column is set (`false`: it is NULL). */
  isSet: boolean;
  /** `?isLocked=true` - the timestamp is later than now (`false`: it is not). */
  inFuture: boolean;
};

export type ListFilterKind = keyof ListFilterValueMap;

export type ListFilterDefinition = {
  kind: ListFilterKind;
  /** Entity field that the filter reads. The param name when omitted. */
  field?: string;
  /** The accepted values of a `scopeIncludes` filter. */
  values?: readonly string[];
};

/**
 * One list endpoint: its search, its filters, its other params and its sort
 * columns. The server builds its query DTO and its SQL from it, the mock builds
 * its validation and its filtering from it, and the client builds its filter
 * state and its URL params from it, so one definition keeps the three in step.
 */
export type ListQuerySpec = {
  /**
   * Fields that `q` matches: a row matches when any of them contains `q`. An
   * empty list means the endpoint has no `q` param.
   */
  search: readonly string[];
  /** Filter param name -> definition. Every filter set is ANDed. */
  filters: Readonly<Record<string, ListFilterDefinition>>;
  /**
   * Params that are validated like a filter of the same kind but that are not
   * a condition on one column (a join, a scope switch). The service applies
   * each one itself.
   */
  params?: Readonly<Record<string, ListFilterDefinition>>;
  /**
   * The `sortBy` whitelist. Keyset pagination needs NOT NULL columns only; see
   * `sort-columns.constants.ts`.
   */
  sort: readonly string[];
};

type ListParamValues<D extends Readonly<Record<string, ListFilterDefinition>>> =
  {
    -readonly [P in keyof D]?: ListFilterValueMap[D[P]['kind']];
  };

/** The parsed search and filter params of a list built from `S`. */
export type ListQuery<S extends ListQuerySpec> = {
  q?: string;
} & ListParamValues<S['filters']>;

/** The parsed `params` of a list built from `S`. */
export type ListParams<S extends ListQuerySpec> =
  S['params'] extends Readonly<Record<string, ListFilterDefinition>>
    ? ListParamValues<S['params']>
    : Record<never, never>;

/** Everything that narrows a list built from `S`: the state of its filter bar. */
export type ListFilters<S extends ListQuerySpec> = ListQuery<S> & ListParams<S>;

/** A `sortBy` value that a list built from `S` accepts. */
export type ListSortColumn<S extends ListQuerySpec> = S['sort'][number];
