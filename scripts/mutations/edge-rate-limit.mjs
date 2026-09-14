// Mutation set for src/lib/server/edge-rate-limit.ts -- run with:
//   node scripts/mutations/run.mjs edge-rate-limit
//
// Each mutation below either puts the database round trip back on the hottest read paths, refuses
// guests when the limiter itself is at fault, or removes the limit altogether.
export default {
  file: 'src/lib/server/edge-rate-limit.ts',
  test: 'tests/edge-rate-limit.test.ts',
  mutations: [
    { name: 'THE EDGE BINDING IS NEVER USED -- every read pays the database round trip again',
      from: '  if (binding) {', to: '  if (false) {' },
    { name: 'a refusal from the binding is ignored',
      from: '      return success ? { ok: true } : { ok: false, retryAfterSeconds: READ_LIMIT_PERIOD_SECONDS }', to: '      return { ok: true }' },
    { name: 'A LIMITER FAULT REFUSES EVERY GUEST',
      from: '    } catch {\n      return { ok: true }\n    }', to: '    } catch {\n      return { ok: false, retryAfterSeconds: READ_LIMIT_PERIOD_SECONDS }\n    }' },
    { name: 'a missing binding means no limit at all',
      from: '  return deps.fallback(key, READ_LIMIT_PERIOD_SECONDS, spec.perMinute, { failOpen: true })', to: '  return { ok: true }' },
    { name: 'the database fallback fails closed, refusing guests during a database blip',
      from: '{ failOpen: true })', to: '{ failOpen: false })' },
    { name: 'something that is not a limiter is called as one',
      from: "binding = typeof candidate?.limit === 'function' ? candidate : undefined", to: 'binding = candidate' },
    { name: 'the photo read limit drops tenfold, which a venue full of guests would hit',
      from: "prefix: 'album_photos', perMinute: 20000", to: "prefix: 'album_photos', perMinute: 2000" },
  ],
}
