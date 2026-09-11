// Mutation set for src/lib/use-browser-value.ts -- run with:
//   node scripts/mutations/run.mjs use-browser-value
//
// THE ONE PLACE A BROWSER-ONLY VALUE IS READ. Getting this wrong is not a crash: it is a hydration
// mismatch, which React resolves by throwing the subtree away and remounting it, and which shows up
// as a console error in production and a flicker to the person looking at the page. Every mutation
// here is a way to reintroduce exactly that.
export default {
  file: 'src/lib/use-browser-value.ts',
  test: 'tests/use-browser-value.test.tsx',
  mutations: [
  { name: 'THE VALUE IS READ DURING RENDER, which is the hydration mismatch this file exists to avoid',
    from: "  const [value, setValue] = useState<T>(fallback)", to: "  const [value, setValue] = useState<T>(read)" },
  { name: 'the fallback is ignored, so the first render has nothing the server could have sent',
    from: "  const [value, setValue] = useState<T>(fallback)", to: "  const [value, setValue] = useState<T>(undefined as T)" },
  { name: 'the read never happens, so the fallback is all anyone ever sees',
    from: "    setValue(v)\n", to: "" },
  { name: 'the read runs on EVERY render, so a random pick never settles',
    from: "  }, [])\n  return [value, setValue]", to: "  })\n  return [value, setValue]" },
  { name: 'a read that throws takes the page down instead of leaving the fallback standing',
    from: "    } catch {\n      return\n    }", to: "    } finally {\n      void 0\n    }" },
  { name: 'a legitimately falsy value is discarded, so an empty query parameter reads as absent',
    from: "    setValue(v)", to: "    if (v) setValue(v)" },
  { name: 'useBrowserValue returns the setter instead of the value',
    from: "  return useBrowserSeededState(read, fallback)[0]", to: "  return useBrowserSeededState(read, fallback)[1] as unknown as T" },
  { name: 'useHydrated claims the client on the very first render',
    from: "  return useBrowserValue(() => true, false)", to: "  return useBrowserValue(() => true, true)" },
  { name: 'useHydrated never becomes true, so anything gated on it never renders',
    from: "  return useBrowserValue(() => true, false)", to: "  return useBrowserValue(() => false, false)" },
  ],
}
