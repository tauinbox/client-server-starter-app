import { Logger } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { ErrorKeys } from '@app/shared/constants';
import type { PermissionCondition } from '@app/shared/types';
import {
  AbilityBuilder,
  createMongoAbility,
  type AppAbility,
  type Subjects
} from '../casl/app-ability';
import { resolveConditions } from '../casl/resolve-conditions';
import {
  assertCanGrantPermissions,
  type ResolvedGrantItem
} from './can-grant.util';

const CALLER_ID = 'caller-id';

describe('assertCanGrantPermissions', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger('can-grant.spec');
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  /**
   * Builds the caller's ability the same way CaslAbilityFactory does - the
   * authored condition goes through resolveConditions before it reaches
   * can() - so the rules the check inspects are the real ones.
   */
  function abilityFor(
    grants: {
      action: string;
      subject: string;
      conditions?: PermissionCondition;
    }[]
  ): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    for (const g of grants) {
      const subject = g.subject as Extract<Subjects, string>;
      if (!g.conditions) {
        can(g.action, subject);
        continue;
      }
      const { query } = resolveConditions(g.conditions, {
        userId: CALLER_ID,
        permissionLabel: `${g.action}:${g.subject}`,
        logger
      });
      can(g.action, subject, query);
    }
    return build();
  }

  function superAbility(): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    can('manage', 'all');
    return build();
  }

  function item(
    bodyConditions?: PermissionCondition | null
  ): ResolvedGrantItem {
    return {
      permissionId: 'perm-1',
      actionName: 'update',
      subject: 'User',
      bodyConditions: bodyConditions ?? null
    };
  }

  function grant(
    ability: AppAbility,
    bodyConditions?: PermissionCondition | null
  ): void {
    assertCanGrantPermissions(ability, [item(bodyConditions)], {
      actorId: CALLER_ID,
      logger
    });
  }

  const ownershipOnly = abilityForOwnership();

  function abilityForOwnership(): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
    can('update', 'User' as Extract<Subjects, string>, { id: CALLER_ID });
    return build();
  }

  describe('narrowing an existing predicate rather than adding one', () => {
    const CALLER_SET: PermissionCondition = {
      fieldMatch: { isActive: [true, false] }
    };

    function abilityOverSet() {
      return abilityFor([
        { action: 'update', subject: 'User', conditions: CALLER_SET }
      ]);
    }

    it('allows a grant whose value set is a subset of the caller set', () => {
      expect(() =>
        grant(abilityOverSet(), { fieldMatch: { isActive: [true] } })
      ).not.toThrow();
    });

    it('allows a scalar grant admitted by the caller set', () => {
      expect(() =>
        grant(abilityOverSet(), { custom: '{"isActive":true}' })
      ).not.toThrow();
    });

    it('rejects a grant whose value set escapes the caller set', () => {
      const ability = abilityFor([
        {
          action: 'update',
          subject: 'User',
          conditions: { fieldMatch: { isActive: [true] } }
        }
      ]);

      try {
        grant(ability, { fieldMatch: { isActive: [true, false] } });
        throw new Error('expected a 403');
      } catch (err) {
        expect((err as HttpException).getResponse()).toMatchObject({
          errorKey: ErrorKeys.ROLES.CONDITION_BROADER_THAN_CALLER
        });
      }
    });

    it('rejects a grant that swaps the value for one the caller lacks', () => {
      const ability = abilityFor([
        {
          action: 'update',
          subject: 'User',
          conditions: { fieldMatch: { isActive: [true] } }
        }
      ]);

      try {
        grant(ability, { fieldMatch: { isActive: [false] } });
        throw new Error('expected a 403');
      } catch (err) {
        expect((err as HttpException).getResponse()).toMatchObject({
          errorKey: ErrorKeys.ROLES.CONDITION_BROADER_THAN_CALLER
        });
      }
    });

    it('rejects a predicate shape it cannot decide, rather than assuming it is narrow', () => {
      const ability = abilityFor([
        {
          action: 'update',
          subject: 'User',
          conditions: { custom: '{"loginCount":{"$gt":5}}' }
        }
      ]);

      // `$gt: 10` really is narrower than `$gt: 5`, but ranges are not decided
      // here - the check refuses what it cannot prove instead of guessing.
      try {
        grant(ability, { custom: '{"loginCount":{"$gt":10}}' });
        throw new Error('expected a 403');
      } catch (err) {
        expect((err as HttpException).getResponse()).toMatchObject({
          errorKey: ErrorKeys.ROLES.CONDITION_BROADER_THAN_CALLER
        });
      }
    });
  });

  describe('caller holds the permission only under a condition', () => {
    const OWNERSHIP: PermissionCondition = {
      ownership: { userField: 'id' }
    };

    it('allows an equal condition', () => {
      const ability = abilityFor([
        { action: 'update', subject: 'User', conditions: OWNERSHIP }
      ]);

      expect(() => grant(ability, OWNERSHIP)).not.toThrow();
    });

    it('allows a stricter condition that keeps the caller predicate', () => {
      const ability = abilityFor([
        { action: 'update', subject: 'User', conditions: OWNERSHIP }
      ]);

      expect(() =>
        grant(ability, {
          ownership: { userField: 'id' },
          fieldMatch: { isActive: [true] }
        })
      ).not.toThrow();
    });

    it('rejects a broader fieldMatch condition that drops the caller predicate', () => {
      const ability = abilityFor([
        { action: 'update', subject: 'User', conditions: OWNERSHIP }
      ]);

      try {
        grant(ability, { fieldMatch: { isActive: [true] } });
        throw new Error('expected a 403');
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException);
        const httpErr = err as HttpException;
        expect(httpErr.getStatus()).toBe(403);
        expect(httpErr.getResponse()).toMatchObject({
          errorKey: ErrorKeys.ROLES.CONDITION_BROADER_THAN_CALLER,
          details: { reason: 'condition-broader-than-caller' }
        });
      }
    });

    it('rejects a broader custom condition that drops the caller predicate', () => {
      const ability = abilityFor([
        { action: 'update', subject: 'User', conditions: OWNERSHIP }
      ]);

      try {
        grant(ability, { custom: '{"isActive":true}' });
        throw new Error('expected a 403');
      } catch (err) {
        expect((err as HttpException).getResponse()).toMatchObject({
          errorKey: ErrorKeys.ROLES.CONDITION_BROADER_THAN_CALLER
        });
      }
    });

    it('rejects an omitted condition (pre-existing branch, unchanged)', () => {
      const ability = abilityFor([
        { action: 'update', subject: 'User', conditions: OWNERSHIP }
      ]);

      try {
        grant(ability, null);
        throw new Error('expected a 403');
      } catch (err) {
        expect((err as HttpException).getResponse()).toMatchObject({
          errorKey: ErrorKeys.ROLES.CANNOT_GRANT_PERMISSION,
          details: { reason: 'condition-escalation' }
        });
      }
    });

    it('rejects a condition the resolver vetoes instead of treating it as unrestricted', () => {
      const ability = abilityFor([
        { action: 'update', subject: 'User', conditions: OWNERSHIP }
      ]);

      try {
        grant(ability, { userAttr: { managerId: 'department' } });
        throw new Error('expected a 403');
      } catch (err) {
        const httpErr = err as HttpException;
        expect(httpErr.getStatus()).toBe(403);
        expect(httpErr.getResponse()).toMatchObject({
          errorKey: ErrorKeys.ROLES.CONDITION_UNRESOLVABLE,
          details: { reason: 'condition-unresolvable' }
        });
      }
    });

    it('refuses to skip the comparison when the acting user id is unavailable', () => {
      const ability = abilityFor([
        { action: 'update', subject: 'User', conditions: OWNERSHIP }
      ]);

      expect(() =>
        assertCanGrantPermissions(
          ability,
          [item({ fieldMatch: { isActive: [true] } })],
          { logger }
        )
      ).toThrow(/acting user id/);
    });

    it('matches the rule built straight from can() with the resolved query', () => {
      expect(() => grant(ownershipOnly, OWNERSHIP)).not.toThrow();
    });
  });

  describe('callers the check does not constrain', () => {
    it('leaves an unconditional holder free to grant any condition', () => {
      const ability = abilityFor([{ action: 'update', subject: 'User' }]);

      expect(() =>
        grant(ability, { fieldMatch: { isActive: [true] } })
      ).not.toThrow();
      expect(() => grant(ability, null)).not.toThrow();
    });

    it('leaves a super caller free to grant any condition', () => {
      expect(() =>
        grant(superAbility(), { fieldMatch: { isActive: [true] } })
      ).not.toThrow();
    });
  });

  it('still rejects an action the caller does not hold at all', () => {
    const ability = abilityFor([{ action: 'read', subject: 'User' }]);

    try {
      grant(ability, { ownership: { userField: 'id' } });
      throw new Error('expected a 403');
    } catch (err) {
      expect((err as HttpException).getResponse()).toMatchObject({
        errorKey: ErrorKeys.ROLES.CANNOT_GRANT_PERMISSION
      });
    }
  });
});
