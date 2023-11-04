import { Seeder } from '@jorgebodega/typeorm-seeding';
import { FeatureEntity } from '../modules/feature/entity/feature.entity';
import { DataSource } from 'typeorm';

export default class FeatureEntitySeeder extends Seeder {
  async run(dataSource: DataSource) {
    const entities: FeatureEntity[] = new Array(100)
      .fill(null)
      .map((v, index) => {
        const e = new FeatureEntity();
        e.name = `Feature Entity - ${index + 1}`;
        return e;
      });
    await dataSource.createEntityManager().save<FeatureEntity>(entities);
  }
}
