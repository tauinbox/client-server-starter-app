import { Injectable } from '@nestjs/common';
import { PermissionCondition } from '@app/shared/types';

export interface PolicyContext {
  userId: string;
  resourceOwnerId?: string;
  resource?: Record<string, unknown>;
}

type CustomEvaluator = (context: PolicyContext) => boolean;

@Injectable()
export class PolicyEvaluatorService {
  private customEvaluators = new Map<string, CustomEvaluator>();

  registerEvaluator(name: string, fn: CustomEvaluator): void {
    this.customEvaluators.set(name, fn);
  }

  evaluate(conditions: PermissionCondition, context: PolicyContext): boolean {
    if (conditions.ownership) {
      if (!context.resourceOwnerId) {
        return false;
      }
      if (context.userId !== context.resourceOwnerId) {
        return false;
      }
    }

    if (conditions.fieldMatch && context.resource) {
      for (const [field, allowedValues] of Object.entries(
        conditions.fieldMatch
      )) {
        const value = context.resource[field];
        if (!allowedValues.includes(value)) {
          return false;
        }
      }
    }

    if (conditions.custom) {
      const evaluator = this.customEvaluators.get(conditions.custom);
      if (!evaluator) {
        return false;
      }
      if (!evaluator(context)) {
        return false;
      }
    }

    return true;
  }
}
