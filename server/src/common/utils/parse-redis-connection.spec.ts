import { parseRedisConnection } from './parse-redis-connection';

describe('parseRedisConnection', () => {
  it('splits host and port', () => {
    expect(parseRedisConnection('redis://localhost:6379')).toEqual({
      host: 'localhost',
      port: 6379
    });
  });

  it('defaults the port when the URL omits it', () => {
    expect(parseRedisConnection('redis://cache.internal')).toEqual({
      host: 'cache.internal',
      port: 6379
    });
  });

  it('decodes credentials', () => {
    expect(
      parseRedisConnection('rediss://user:p%40ss@cache.internal:6380')
    ).toEqual({
      host: 'cache.internal',
      port: 6380,
      username: 'user',
      password: 'p@ss'
    });
  });

  it('carries the logical database from the URL path', () => {
    expect(parseRedisConnection('redis://localhost:6379/15')).toEqual({
      host: 'localhost',
      port: 6379,
      db: 15
    });
  });

  it('omits the database when the path is empty or not an index', () => {
    expect(parseRedisConnection('redis://localhost:6379')).not.toHaveProperty(
      'db'
    );
    expect(parseRedisConnection('redis://localhost:6379/')).not.toHaveProperty(
      'db'
    );
    expect(
      parseRedisConnection('redis://localhost:6379/queue')
    ).not.toHaveProperty('db');
  });
});
