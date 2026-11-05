// The `rebuild-db` Vite plugin generates this module: the Quack server's URI
// and authentication token, handed to the DuckDB-Wasm client in src/quack.ts.
// In dev the values come from the server the plugin runs; production builds
// read QUACK_URI / QUACK_TOKEN from the environment.
declare module 'virtual:quack-config' {
  export const quackUri: string;
  export const quackToken: string;
}
