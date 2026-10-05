import { applyDecorators, type Type } from '@nestjs/common';
import { ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength
} from 'class-validator';
import {
  DEFAULT_SORT_BY,
  MAX_LIST_FILTER_LENGTH,
  MAX_PAGE_SIZE
} from '@app/shared/constants';
import type {
  ListFilterDefinition,
  ListFilterKind,
  ListParams,
  ListQuery,
  ListQuerySpec
} from '@app/shared/types';
import { toIdList, toOptionalBoolean } from '../utils/query-transforms';
import { CursorPaginationQueryDto } from './cursor-pagination-query.dto';

// The validators of one property are listed in reverse: applyDecorators runs
// them in array order, while stacked decorators run bottom-up, and the order
// decides the order of the messages in a 400.
function textParam(description: string): PropertyDecorator {
  return applyDecorators(
    MaxLength(MAX_LIST_FILTER_LENGTH),
    IsString(),
    IsOptional(),
    ApiPropertyOptional({
      type: String,
      maxLength: MAX_LIST_FILTER_LENGTH,
      description
    })
  );
}

function booleanParam(description: string): PropertyDecorator {
  return applyDecorators(
    Transform(toOptionalBoolean),
    IsBoolean(),
    IsOptional(),
    ApiPropertyOptional({ type: Boolean, description })
  );
}

const FILTER_DECORATORS: Record<
  ListFilterKind,
  (name: string, definition: ListFilterDefinition) => PropertyDecorator
> = {
  boolean: (name) => booleanParam(`Filter by ${name}`),
  isSet: (name, { field = name }) =>
    booleanParam(`true: ${field} is set; false: ${field} is not set`),
  inFuture: (name, { field = name }) =>
    booleanParam(`true: ${field} is later than now; false: it is not`),
  scopeIncludes: (_name, { field, values = [] }) =>
    applyDecorators(
      IsIn(values),
      IsOptional(),
      ApiPropertyOptional({
        enum: values,
        description: `Rows that apply there: ${field} is empty (applies everywhere) or holds the value`
      })
    ),
  contains: (name) =>
    textParam(`Filter by ${name} (case-insensitive partial match)`),
  uuidList: () =>
    applyDecorators(
      Transform(toIdList),
      IsUUID('all', { each: true }),
      ArrayMaxSize(MAX_PAGE_SIZE),
      IsArray(),
      IsOptional(),
      ApiPropertyOptional({
        type: String,
        description: `Comma-separated ids (at most ${MAX_PAGE_SIZE}); returns only these rows`
      })
    )
};

/**
 * Builds the search, filter and param half of a list query DTO from its shared
 * definition. `ListCursorQueryDto` combines it with the paging params.
 */
export function ListQueryDto<S extends ListQuerySpec>(
  spec: S
): Type<ListQuery<S> & ListParams<S>> {
  class ListQueryHost {}
  const target = ListQueryHost.prototype;

  if (spec.search.length > 0) {
    textParam(
      `Case-insensitive substring search across ${spec.search.join(', ')}. Combined with the other filters via AND.`
    )(target, 'q');
  }
  for (const [name, definition] of Object.entries(spec.filters)) {
    FILTER_DECORATORS[definition.kind](name, definition)(target, name);
  }
  if (!spec.params) return ListQueryHost;

  // The params sit on a subclass: class-validator reports the own properties
  // of a class before the inherited ones, so they come before `q`.
  class ListParamsHost extends ListQueryHost {}
  for (const [name, definition] of Object.entries(spec.params)) {
    FILTER_DECORATORS[definition.kind](name, definition)(
      ListParamsHost.prototype,
      name
    );
  }
  return ListParamsHost;
}

export type ListCursorQuery<S extends ListQuerySpec> =
  CursorPaginationQueryDto & ListQuery<S> & ListParams<S>;

/**
 * The query DTO of a cursor-paginated list endpoint: the paging params, the
 * list params of `spec`, and `sortBy` limited to `spec.sort`. The whitelist is
 * required because the keyset helper mints the next cursor from the named
 * property - an unlisted column yields a cursor that cannot resolve a page.
 */
export function ListCursorQueryDto<S extends ListQuerySpec>(
  spec: S
): Type<ListCursorQuery<S>> {
  const listParams: Type<object> = ListQueryDto(spec);
  class ListCursorQueryHost extends IntersectionType(
    CursorPaginationQueryDto,
    listParams
  ) {}
  applyDecorators(
    IsIn(spec.sort),
    IsOptional(),
    ApiPropertyOptional({ default: DEFAULT_SORT_BY, enum: spec.sort })
  )(ListCursorQueryHost.prototype, 'sortBy');
  // TypeScript cannot extend an intersection over a generic `spec`, so the
  // list params of the class are typed here; ListQueryDto(spec) declares them.
  return ListCursorQueryHost as Type<ListCursorQuery<S>>;
}
