import {
  SETTINGS_ENTITIES,
  regionalEntities,
  splitPoolMax
} from './data-sources';
import { Plan } from './modules/billing/entities/plan.entity';
import { Product } from './modules/billing/entities/product.entity';
import { loadEntities } from './postgres.config';

describe('data sources', () => {
  describe('splitPoolMax', () => {
    it.each([
      [2, { regional: 1, settings: 1 }],
      [5, { regional: 4, settings: 1 }],
      [10, { regional: 8, settings: 2 }],
      [32, { regional: 26, settings: 6 }]
    ])('divides %i connections with no extra one', (max, sizes) => {
      expect(splitPoolMax(max)).toEqual(sizes);
    });
  });

  describe('regionalEntities', () => {
    it('gives each entity to exactly one data source', () => {
      const all = loadEntities();
      const regional = regionalEntities(all);

      expect(SETTINGS_ENTITIES).toEqual([Plan, Product]);
      expect(regional).not.toContain(Plan);
      expect(regional).not.toContain(Product);
      expect(regional.length + SETTINGS_ENTITIES.length).toBe(all.length);
    });
  });
});
