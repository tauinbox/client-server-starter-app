import { applyDecorators, type Type } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
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
import { MAX_LIST_FILTER_LENGTH, MAX_PAGE_SIZE } from '@app/shared/constants';
import type {
  ListFilterDefinition,
  ListFilterKind,
  ListQuery,
  ListQuerySpec
} from '@app/shared/types';
import { toIdList, toOptionalBoolean } from '../utils/query-transforms';

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
 * Builds the search and filter half of a list query DTO from its shared
 * definition. Combine it with `CursorPaginationQueryDto` through
 * `IntersectionType`, and pass the same definition to `applyListQuery`.
 */
export function ListQueryDto<S extends ListQuerySpec>(
  spec: S
): Type<ListQuery<S>> {
  class ListQueryHost {}
  const target = ListQueryHost.prototype;

  textParam(
    `Case-insensitive substring search across ${spec.search.join(', ')}. Combined with the other filters via AND.`
  )(target, 'q');
  for (const [name, definition] of Object.entries(spec.filters)) {
    FILTER_DECORATORS[definition.kind](name, definition)(target, name);
  }

  return ListQueryHost;
}
