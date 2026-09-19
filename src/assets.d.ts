declare module "*.ttf" {
  const path: string;
  export default path;
}
declare module "*.jpg" {
  const path: string;
  export default path;
}
declare module "*.svg" {
  const svg: string;
  export default svg;
}
declare module "*.node" {
  const bindings: Parameters<
    typeof import("@gpuix/native/runtime").configureNativeBindings
  >[0];
  export default bindings;
}
declare module "*.wasm" {
  const path: string;
  export default path;
}
