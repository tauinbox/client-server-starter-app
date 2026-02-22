import { PolicyEvaluatorService } from './policy-evaluator.service';
import { PermissionCondition } from '@app/shared/types';

describe('PolicyEvaluatorService', () => {
  let service: PolicyEvaluatorService;

  beforeEach(() => {
    service = new PolicyEvaluatorService();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('evaluate', () => {
    it('should return true when no conditions apply', () => {
      const conditions: PermissionCondition = {};
      const result = service.evaluate(conditions, { userId: 'user-1' });
      expect(result).toBe(true);
    });

    describe('ownership condition', () => {
      const conditions: PermissionCondition = {
        ownership: { userField: 'id' }
      };

      it('should return true when user is the resource owner', () => {
        const result = service.evaluate(conditions, {
          userId: 'user-1',
          resourceOwnerId: 'user-1'
        });
        expect(result).toBe(true);
      });

      it('should return false when user is not the resource owner', () => {
        const result = service.evaluate(conditions, {
          userId: 'user-1',
          resourceOwnerId: 'user-2'
        });
        expect(result).toBe(false);
      });

      it('should return false when resourceOwnerId is not provided', () => {
        const result = service.evaluate(conditions, { userId: 'user-1' });
        expect(result).toBe(false);
      });
    });

    describe('fieldMatch condition', () => {
      const conditions: PermissionCondition = {
        fieldMatch: { status: ['active', 'pending'] }
      };

      it('should return true when field matches allowed values', () => {
        const result = service.evaluate(conditions, {
          userId: 'user-1',
          resource: { status: 'active' }
        });
        expect(result).toBe(true);
      });

      it('should return false when field does not match', () => {
        const result = service.evaluate(conditions, {
          userId: 'user-1',
          resource: { status: 'archived' }
        });
        expect(result).toBe(false);
      });
    });

    describe('custom condition', () => {
      it('should return true when custom evaluator passes', () => {
        service.registerEvaluator('always-true', () => true);
        const conditions: PermissionCondition = { custom: 'always-true' };
        const result = service.evaluate(conditions, { userId: 'user-1' });
        expect(result).toBe(true);
      });

      it('should return false when custom evaluator fails', () => {
        service.registerEvaluator('always-false', () => false);
        const conditions: PermissionCondition = { custom: 'always-false' };
        const result = service.evaluate(conditions, { userId: 'user-1' });
        expect(result).toBe(false);
      });

      it('should return false when custom evaluator is not registered', () => {
        const conditions: PermissionCondition = { custom: 'unknown' };
        const result = service.evaluate(conditions, { userId: 'user-1' });
        expect(result).toBe(false);
      });
    });

    describe('combined conditions', () => {
      it('should require all conditions to pass', () => {
        service.registerEvaluator('check', () => true);
        const conditions: PermissionCondition = {
          ownership: { userField: 'id' },
          custom: 'check'
        };

        const pass = service.evaluate(conditions, {
          userId: 'user-1',
          resourceOwnerId: 'user-1'
        });
        expect(pass).toBe(true);

        const fail = service.evaluate(conditions, {
          userId: 'user-1',
          resourceOwnerId: 'user-2'
        });
        expect(fail).toBe(false);
      });
    });
  });
});
