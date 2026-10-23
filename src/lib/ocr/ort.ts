import type * as OrtNS from 'onnxruntime-web'

/** The subset of onnxruntime-web the pipeline uses; lets Node tests and the worker share the code. */
export type Ort = typeof OrtNS
export type Session = OrtNS.InferenceSession
