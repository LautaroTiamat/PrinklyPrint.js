import { defineConfig } from 'tsup';

// tsup compila TypeScript a ESM + CJS + .d.ts en un solo paso.
// Generamos dos entry points separados:
//   - index   → API core (vanilla JS, cero dependencias además de fetch).
//   - react   → adapter con hooks. Marca React como external para que el bundle
//               quede liviano y use la copia de React del proyecto consumidor.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    react: 'src/react.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  // Sin sourcemaps en el paquete publicado: embebían todo src/ vía
  // sourcesContent y duplicaban el peso del tarball. El código fuente está
  // público en GitHub para quien necesite debuggear.
  sourcemap: false,
  clean: true,
  splitting: false,
  treeshake: true,
  // React es peerDependency: NUNCA debe estar en nuestro bundle.
  external: ['react'],
});
