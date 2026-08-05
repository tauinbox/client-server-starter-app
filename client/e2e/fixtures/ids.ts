/**
 * Seed ids are UUIDs so the mock reproduces the server's `ParseUUIDPipe`
 * rejection of malformed ids; `mockId` maps the readable slug a spec cares
 * about ('user-1') onto the very id the mock seeds.
 */
export { mockId } from '../../../mock-server/src/utils/mock-id';
