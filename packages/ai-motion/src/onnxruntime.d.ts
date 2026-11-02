declare module "onnxruntime-node" {
  export class Tensor { constructor(type: "float32", data: Float32Array, dims: readonly number[]); readonly data: Float32Array; readonly dims: readonly number[] }
  export const InferenceSession: { create(path: string, options?: { intraOpNumThreads?: number }): Promise<unknown> };
}
